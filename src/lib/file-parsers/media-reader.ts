export interface InlineDataPart {
  inlineData: {
    mimeType: string;
    data: string; // Base64 encoded payload
  };
}

export interface MediaParseResult {
  success: boolean;
  subjectType: "IMAGE" | "DOCUMENT";
  extractedText: string;
  inlineDataParts: InlineDataPart[];
  summary: {
    fileName: string;
    extension: string;
    mimeType: string;
    byteSize: number;
  };
  errorReason?: string;
}

const MAX_INLINE_MEDIA_BYTES = 20 * 1024 * 1024; // 20 MB limit for Gemini inlineData

const MIME_BY_EXTENSION: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
};

function computeCrc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Verifies magic bytes, chunk CRCs, and bitstream/object headers
 * of image and PDF files to catch corrupted, truncated, or spoofed files.
 */
function verifyMediaSignature(buf: Buffer, ext: string): boolean {
  if (!buf || buf.length < 8) return false;

  switch (ext) {
    case ".png": {
      // PNG requires 8-byte signature + valid chunk chain with CRC-32, IHDR, valid zlib IDAT, and IEND
      if (
        buf.length < 45 ||
        buf[0] !== 0x89 ||
        buf[1] !== 0x50 ||
        buf[2] !== 0x4e ||
        buf[3] !== 0x47 ||
        buf[4] !== 0x0d ||
        buf[5] !== 0x0a ||
        buf[6] !== 0x1a ||
        buf[7] !== 0x0a
      ) {
        return false;
      }
      const firstLen = buf.readUInt32BE(8);
      const firstChunkType = buf.subarray(12, 16).toString("ascii");
      if (firstChunkType !== "IHDR" || firstLen !== 13) return false;
      const width = buf.readUInt32BE(16);
      const height = buf.readUInt32BE(20);
      const bitDepth = buf[24];
      const colorType = buf[25];
      const compression = buf[26];
      const filter = buf[27];
      const interlace = buf[28];
      if (width <= 0 || height <= 0 || width > 65535 || height > 65535) return false;
      if (compression !== 0 || filter !== 0 || (interlace !== 0 && interlace !== 1)) {
        return false;
      }
      const validBitDepths: Record<number, number[]> = {
        0: [1, 2, 4, 8, 16],
        2: [8, 16],
        3: [1, 2, 4, 8],
        4: [8, 16],
        6: [8, 16],
      };
      if (!validBitDepths[colorType] || !validBitDepths[colorType].includes(bitDepth)) {
        return false;
      }

      let offset = 8;
      const idatChunks: Buffer[] = [];
      let hasIend = false;
      while (offset < buf.length) {
        if (offset + 12 > buf.length) return false;
        const chunkLen = buf.readUInt32BE(offset);
        const chunkType = buf.subarray(offset + 4, offset + 8).toString("ascii");
        if (!/^[A-Za-z]{4}$/.test(chunkType)) return false;
        const dataStart = offset + 8;
        const dataEnd = dataStart + chunkLen;
        const nextOffset = dataEnd + 4;
        if (nextOffset > buf.length) return false;

        const expectedCrc = buf.readUInt32BE(dataEnd);
        const actualCrc = computeCrc32(buf.subarray(offset + 4, dataEnd));
        if (expectedCrc !== actualCrc) return false;

        if (chunkType === "IDAT") {
          if (chunkLen <= 0) return false;
          idatChunks.push(buf.subarray(dataStart, dataEnd));
        }
        if (chunkType === "IEND") {
          if (chunkLen !== 0 || nextOffset !== buf.length) return false;
          hasIend = true;
          break;
        }
        offset = nextOffset;
      }
      if (idatChunks.length === 0 || !hasIend) return false;

      const idatBuf = Buffer.concat(idatChunks);
      if (idatBuf.length < 6) return false;
      const cmf = idatBuf[0];
      const flg = idatBuf[1];
      if (
        (cmf & 0x0f) !== 8 ||
        cmf >>> 4 > 7 ||
        ((cmf << 8) + flg) % 31 !== 0 ||
        (flg & 0x20) !== 0
      ) {
        return false;
      }
      const btype = (idatBuf[2] >>> 1) & 3;
      if (btype === 3) return false;

      const builtinZlib =
        typeof (process as any)?.getBuiltinModule === "function"
          ? (process as any).getBuiltinModule("node:zlib")
          : null;
      if (builtinZlib && typeof builtinZlib.inflateSync === "function") {
        try {
          const raw = builtinZlib.inflateSync(idatBuf) as Buffer;
          const channels =
            colorType === 0
              ? 1
              : colorType === 2
              ? 3
              : colorType === 3
              ? 1
              : colorType === 4
              ? 2
              : 4;
          const bitsPerPixel = channels * bitDepth;
          const rowBytes = 1 + Math.ceil((width * bitsPerPixel) / 8);
          if (interlace === 0) {
            if (raw.length !== rowBytes * height) return false;
            for (let y = 0; y < height; y++) {
              if (raw[y * rowBytes] > 4) return false;
            }
          } else {
            const adam7Passes = [
              [0, 8, 0, 8],
              [4, 8, 0, 8],
              [0, 4, 4, 8],
              [2, 4, 0, 4],
              [0, 2, 2, 4],
              [1, 2, 0, 2],
              [0, 1, 1, 2],
            ];
            let rawOffset = 0;
            for (const [x0, dx, y0, dy] of adam7Passes) {
              const passCols = width > x0 ? Math.ceil((width - x0) / dx) : 0;
              const passRows = height > y0 ? Math.ceil((height - y0) / dy) : 0;
              if (passCols > 0 && passRows > 0) {
                const passRowBytes = 1 + Math.ceil((passCols * bitsPerPixel) / 8);
                for (let r = 0; r < passRows; r++) {
                  if (rawOffset + passRowBytes > raw.length) return false;
                  if (raw[rawOffset] > 4) return false;
                  rawOffset += passRowBytes;
                }
              }
            }
            if (rawOffset !== raw.length) return false;
          }
        } catch {
          return false;
        }
      }
      return true;
    }
    case ".jpg":
    case ".jpeg": {
      // JPEG requires SOI (FF D8 FF), DQT, valid SOF dimensions/components, matching SOS components + scan data, and EOI (FF D9)
      if (
        buf.length < 32 ||
        buf[0] !== 0xff ||
        buf[1] !== 0xd8 ||
        buf[2] !== 0xff ||
        buf[buf.length - 2] !== 0xff ||
        buf[buf.length - 1] !== 0xd9
      ) {
        return false;
      }
      let offset = 2;
      let hasDqt = false;
      let hasSof = false;
      let hasSos = false;
      const sofComponents = new Map<number, number>();
      while (offset < buf.length - 2) {
        if (buf[offset] !== 0xff) return false;
        while (offset < buf.length - 2 && buf[offset] === 0xff) {
          offset++;
        }
        if (offset >= buf.length - 2) return false;
        const marker = buf[offset];
        offset++;
        if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
          continue;
        }
        if (marker === 0xd9) {
          break;
        }
        if (offset + 2 > buf.length - 2) return false;
        const segLen = buf.readUInt16BE(offset);
        if (segLen < 2 || offset + segLen > buf.length - 2) return false;
        if (marker === 0xdb) {
          if (segLen < 67) return false;
          hasDqt = true;
        }
        if (
          marker >= 0xc0 &&
          marker <= 0xcf &&
          marker !== 0xc4 &&
          marker !== 0xc8 &&
          marker !== 0xcc
        ) {
          if (segLen < 11) return false;
          const precision = buf[offset + 2];
          const height = buf.readUInt16BE(offset + 3);
          const width = buf.readUInt16BE(offset + 5);
          const numComp = buf[offset + 7];
          if (
            precision !== 8 ||
            height <= 0 ||
            width <= 0 ||
            (numComp !== 1 && numComp !== 3 && numComp !== 4) ||
            segLen !== 8 + 3 * numComp
          ) {
            return false;
          }
          sofComponents.clear();
          for (let i = 0; i < numComp; i++) {
            const compId = buf[offset + 8 + i * 3];
            const samp = buf[offset + 9 + i * 3];
            const qtId = buf[offset + 10 + i * 3];
            const hSamp = samp >> 4;
            const vSamp = samp & 0x0f;
            if (
              sofComponents.has(compId) ||
              hSamp < 1 ||
              hSamp > 4 ||
              vSamp < 1 ||
              vSamp > 4 ||
              qtId > 3
            ) {
              return false;
            }
            sofComponents.set(compId, qtId);
          }
          hasSof = true;
        }
        if (marker === 0xda) {
          if (!hasSof || segLen < 8) return false;
          const sosComp = buf[offset + 2];
          if (
            (sosComp !== 1 && sosComp !== 3 && sosComp !== 4) ||
            sosComp > sofComponents.size ||
            segLen !== 6 + 2 * sosComp
          ) {
            return false;
          }
          const seenSosComp = new Set<number>();
          for (let i = 0; i < sosComp; i++) {
            const compId = buf[offset + 3 + i * 2];
            const tdTa = buf[offset + 4 + i * 2];
            if (
              !sofComponents.has(compId) ||
              seenSosComp.has(compId) ||
              tdTa >> 4 > 3 ||
              (tdTa & 0x0f) > 3
            ) {
              return false;
            }
            seenSosComp.add(compId);
          }
          hasSos = true;
          if (offset + segLen >= buf.length - 2) return false;
          break;
        }
        offset += segLen;
      }
      return hasDqt && hasSof && hasSos;
    }
    case ".webp": {
      // "RIFF" + 4-byte size + "WEBP" + valid VP8/VP8L/VP8X bitstream chunks
      if (
        buf.length < 26 ||
        buf.subarray(0, 4).toString("ascii") !== "RIFF" ||
        buf.subarray(8, 12).toString("ascii") !== "WEBP"
      ) {
        return false;
      }
      const riffSize = buf.readUInt32LE(4);
      if (riffSize !== buf.length - 8) return false;

      const kCoeffUpdateProbs = Buffer.from(
        "////////////////////////////////////////////sPb////////////f8fz///////////n9/f////////////T8///////////q/v7///////////3///////////////b+///////////v/f7///////////7//v////////////j+///////////7//7///////////////////////////3+///////////7/v7///////////7//v////////////79//7////////6//7//v////////7/////////////////////////////////////////////////////////2f/////////////h/PH9///+/////+r68fr9//3+//////7////////////f/v7//////////+79/v7///////////j+///////////5/v////////////////////////////3////////////3/v////////////////////////////3+///////////8//////////////////////////////7+///////////9//////////////////////////////79///////////6//////////////7/////////////////////////////////////////////////////////uvv6///////////q+/T+//////////v78/3+//7///////3+///////////s/f7///////////v9/f7+//////////7+///////////+/v7///////////////////////////7////////////+/v////////////7////////////////////////////+////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////+P/////////////6/vz+//////////j++f3///////////39///////////2/f3///////////z++/7+//////////78///////////4/v3///////////3//v7///////////v+///////////1+/7///////////39/v////////////v9///////////8/f7////////////+//////////////z////////////5//7//////////////v/////////////9///////////6///////////////////////////////////////////+////////////////////////////",
        "base64"
      );
      const kDefaultCoeffProbs = Buffer.from(
        "gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA/Yj+/+TbgICAgIC9gfL/49X/24CAgGp+4/zW0f//gICAAWL4/+zi//+AgIC1he7+3er/moCAgE6GyvfGtP/bgICAAbn5//P/gICAgIC4lvf/7OCAgICAgE1u2P/s5oCAgICAAWX7//H/gICAgICqi/H87NH//4CAgCV0xPPk////gICAAcz+//X/gICAgIDPoPr/7oCAgICAgGZn5//Tq4CAgICAAZj8//D/gICAgICxh/P/6uGAgICAgFCB0//C4ICAgICAAQH/gICAgICAgID2Af+AgICAgICAgP+AgICAgICAgICAxiPt38G7oqCRmz6DLcbdrLDcnfzdAUQvktCVp92i/9+AAZXx/93g//+AgIC4jer93tz/x4CAgFFjtfKwvvnK//+AAYHo/dbF8sT//4BjedL6ycb/yoCAgBdbo/Kqu/fS//+AAcj2/+r/gICAgIBtsvH/5/X//4CAgCyCyf3NwP//gICAAYTv+9vR/6WAgIBeiOH72r7//4CAgBZkrvW6of/HgICAAbb5/+jrgICAgIB8j/H/4+qAgICAgCNNtfvB0//NgICAAZ33/+zn//+AgIB5jev/4eP//4CAgC1jvPvD2f/ggICAAQH7/9X/gICAgIDLAfj//4CAgICAgIkBsf/g/4CAgICA/Qn4+8/Q/8CAgICvDeDzwbn5xv//gEkRq92hs+yn/+qAAV/3/dS3//+AgIDvWvT609H//4CAgJtNw/i8w///gICAARjv+9rb/82AgIDJM9v/xLqAgICAgEUuvu/J2v/kgICAAb/7//+AgICAgIDfpfn/1f+AgICAgI18+P//gICAgICAARD4//+AgICAgIC+JOb/7P+AgICAgJUB/4CAgICAgICAAeL/gICAgICAgID3wP+AgICAgICAgPCA/4CAgICAgICAAYb8//+AgICAgIDVPvr//4CAgICAgDdd/4CAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAyhjV67q/3KDwr/9+Jrboqbjkrv+7gD0uituXsvCq/9iAAXDm+se/95///4CmbeT809f/roCAgCdNouistPWy//+AATTc9sbH+dz//4B8Sr/zt8H63f//gBhHgtuaqvO2//+AAbbh+dvw/+CAgICVluL82M3/q4CAgBxsqvK3wv7f//+AAVHm/MzL/8CAgIB7ZtH3vMT/6YCAgBRfmfOkrf/LgICAAd74/9jVgICAgICor/b8683//4CAgC901//T1P//gICAAXns/dTW//+AgICNVNX8ycr/24CAgCpQoPCiuf/NgICAAQH/gICAgICAgID0Af+AgICAgICAgO4B/4CAgICAgICA",
        "base64"
      );
      const kKfBmodeProb = Buffer.from(
        "53gwWXNxeJhwmLNAfqp2LkZfr0WPUFVSSJtnODoKq9q9EQ2YchoRoyzDFQqteRhQwxo+LEBVkEcKJqvVkCIaqi43E4igIc5HPxQIcnLQDAniUSgLYLZUHRAkhrdZiWJlaqWUSLtkgp1vIEtQQmanY0o+KOqAKTUJsvGNGghrSisakkmmMRedQSZpoDM0H3OAaE8MG9n/VxEHV0RHLHIzD7oXLykObra3FRHCQi0ZZsW9FxIWWFiTliouLcTNK2G3dVUmI7M9JzXIVxoVK+irOCIzaHJmHV1NJxxVqzqlWmJAIhZ0zhciK6ZJazYgGjMBUSsfRBlqFkCrJOFyIhMVZoS8EEx8PhJOX1U5MjAzwWUjn9dvWS5vPJQfrNvkFRJvcHFNVbP/JnhyKCoBxPXRChltWCsdjKbVJSuaPT8em0MtRAHRZFAIK5oBMxpHjk5OEP+AIsWrKSgFZtO3BAHdMzIRqNHAFxlSih8kqxumJizlQ1c6qVJzGjuzPztatDumXUmaKCgVdI/RIievLw8QtyLfMS23LhEhtwZiDyC3OS4WGIABNhElQSBJcxyAF4DNKAMJczPAEgbfVyUJcztNQBUvaDcs2gk2NYLiQFpGzSgpFxo5NjlwuAUpJqbVHiIahZh0CiCGJxM13RpyIEn/HwlB6gIPAXZJSyAMM8D/oCszWB8jQ2ZVN7pVOBUXbzvNLSXANyZGfElmASJifWIqWGhVda9SX1Q1WYBkcWUtS097LzOAUasBOREFR2Y5NSkxJiENeTlJGgFVKQpDik1uWi9ycxUCCmb/phcGZR0QClWAZcQaORIKZmbVIhQrdRQPJKOARAEaZj1HJSI1H/PARTxHJkl3HN4lRC2AIgEvC/WrPhETRpJVNz5GJSslmmSjVaABPwlciBxAIMlVSw8JCUD/uHcQVgYcBUD/GfgBOAgRhIn/N3SAOg8UUoc5GnkopDIfiZqFGSPaM2csg4N7HwaeVihAh5TgLbeAFhoRg/CaDgHRLRAVW0DeBwHFOBUnmzyKF2bVUwwNNsD/RC8cVRpVVYCAIJKrEgsHP5CrBAT2IxsKkq6rDBqAvlAjY7RQfjYtVX4vV7AzKRQgZUuAi3aSdIBVOCkPsOxVJQk+Rx4Rd3b/ERKKZSY8ijdGKxqOkiQTHqv/YRsUii09PtsBUbxAICkUdZeOFBWjcBMMPcOAMAQY",
        "base64"
      );
      const kCoeffBands = [0, 1, 2, 3, 6, 4, 5, 6, 6, 6, 6, 6, 6, 6, 6, 7];
      const kCatProbs = [
        [159],
        [165, 145],
        [173, 148, 140],
        [176, 155, 140, 135],
        [180, 157, 141, 134, 130],
        [254, 254, 243, 230, 196, 177, 153, 140, 133, 130, 129],
      ];
      const bModeTree = [
        -1, 2, -2, 4, -3, 6, 8, 12, -4, 10, -5, -6, -7, 14, -8, 16, -9, -10,
      ];

      const makeVp8BoolDecoder = (seg: Buffer) => {
        let range = 254;
        let value = 0n;
        let bits = -8;
        let pos = 0;
        let eof = false;

        const loadFinalBytes = () => {
          if (pos < seg.length) {
            bits += 8;
            value = ((value << 8n) | BigInt(seg[pos++])) & 0xffffffffffffffffn;
          } else if (!eof) {
            value = (value << 8n) & 0xffffffffffffffffn;
            bits += 8;
            eof = true;
          } else {
            bits = 0;
          }
        };

        loadFinalBytes();

        const readBit = (prob = 128): number => {
          let r = range;
          if (bits < 0) {
            loadFinalBytes();
          }
          const p = BigInt(bits);
          const split = (r * prob) >>> 8;
          const v = Number((value >> p) & 0xffn);
          let bit = 0;
          if (v > split) {
            r -= split;
            value -= BigInt(split + 1) << p;
            bit = 1;
          } else {
            r = split + 1;
          }
          const shift = 7 ^ (31 - Math.clz32(r));
          r <<= shift;
          bits -= shift;
          range = r - 1;
          return bit;
        };
        const readLiteral = (n: number): number => {
          let v = 0;
          for (let i = 0; i < n; i++) {
            v = (v << 1) | readBit(128);
          }
          return v;
        };
        return { readBit, readLiteral, isEof: () => eof };
      };

      const isValidVp8Payload = (
        payload: Buffer,
        expectedW?: number,
        expectedH?: number
      ): boolean => {
        if (payload.length < 18) return false;
        if ((payload[0] & 1) !== 0) return false;
        const version = (payload[0] >>> 1) & 7;
        const showFrame = (payload[0] >>> 4) & 1;
        if (version > 3 || showFrame !== 1) return false;
        const firstPartSize = (payload[0] | (payload[1] << 8) | (payload[2] << 16)) >>> 5;
        if (firstPartSize < 6 || 10 + firstPartSize > payload.length) return false;
        if (payload[3] !== 0x9d || payload[4] !== 0x01 || payload[5] !== 0x2a) return false;
        const w = payload.readUInt16LE(6) & 0x3fff;
        const h = payload.readUInt16LE(8) & 0x3fff;
        if (w <= 0 || h <= 0) return false;
        if (
          expectedW !== undefined &&
          expectedH !== undefined &&
          (w !== expectedW || h !== expectedH)
        ) {
          return false;
        }
        const part0 = payload.subarray(10, 10 + firstPartSize);
        const dctPart = payload.subarray(10 + firstPartSize);
        if (part0.length < 6) return false;

        const bd = makeVp8BoolDecoder(part0);
        bd.readBit(128); // color_space
        bd.readBit(128); // clamping_type
        if (bd.isEof()) return false;
        const segEnabled = bd.readBit(128);
        let updateMap = 0;
        const segTreeProbs = [255, 255, 255];
        if (segEnabled === 1) {
          updateMap = bd.readBit(128);
          const updateData = bd.readBit(128);
          if (updateData === 1) {
            bd.readBit(128);
            for (let i = 0; i < 4; i++) {
              if (bd.readBit(128) === 1) bd.readLiteral(8);
            }
            for (let i = 0; i < 4; i++) {
              if (bd.readBit(128) === 1) bd.readLiteral(7);
            }
          }
          if (updateMap === 1) {
            for (let i = 0; i < 3; i++) {
              if (bd.readBit(128) === 1) {
                segTreeProbs[i] = bd.readLiteral(8);
              }
            }
          }
        }
        if (bd.isEof()) return false;
        bd.readBit(128); // filter_type
        bd.readLiteral(6); // loop_filter_level
        bd.readLiteral(3); // sharpness_level
        if (bd.readBit(128) === 1) {
          if (bd.readBit(128) === 1) {
            for (let i = 0; i < 4; i++) {
              if (bd.readBit(128) === 1) bd.readLiteral(7);
            }
            for (let i = 0; i < 4; i++) {
              if (bd.readBit(128) === 1) bd.readLiteral(7);
            }
          }
        }
        if (bd.isEof()) return false;
        const log2NbrPart = bd.readLiteral(2);
        const numDctPartitions = 1 << log2NbrPart;
        const partSizeBytes = (numDctPartitions - 1) * 3;
        if (dctPart.length <= partSizeBytes) return false;
        let dctOffset = partSizeBytes;
        const dctBrs: Array<ReturnType<typeof makeVp8BoolDecoder>> = [];
        for (let p = 0; p < numDctPartitions - 1; p++) {
          const pSize =
            dctPart[p * 3] | (dctPart[p * 3 + 1] << 8) | (dctPart[p * 3 + 2] << 16);
          if (dctOffset + pSize > dctPart.length) return false;
          dctBrs.push(makeVp8BoolDecoder(dctPart.subarray(dctOffset, dctOffset + pSize)));
          dctOffset += pSize;
        }
        if (dctOffset >= dctPart.length) return false;
        dctBrs.push(makeVp8BoolDecoder(dctPart.subarray(dctOffset)));

        bd.readLiteral(7); // y_ac_qi
        for (let i = 0; i < 5; i++) {
          if (bd.readBit(128) === 1) bd.readLiteral(5);
        }
        bd.readBit(128); // refresh_entropy_probs
        if (bd.isEof()) return false;

        const coeffProbs = Buffer.from(kDefaultCoeffProbs);
        for (let idx = 0; idx < 1056; idx++) {
          if (bd.readBit(kCoeffUpdateProbs[idx]) === 1) {
            coeffProbs[idx] = bd.readLiteral(8);
          }
        }

        const mbNoSkipCoeff = bd.readBit(128);
        let probSkipFalse = 0;
        if (mbNoSkipCoeff === 1) {
          probSkipFalse = bd.readLiteral(8);
        }
        if (bd.isEof()) return false;

        const mbW = Math.ceil(w / 16);
        const mbH = Math.ceil(h / 16);
        if (mbW <= 0 || mbH <= 0 || mbW * mbH > 16384) return false;

        const decodeBlock = (
          dbr: ReturnType<typeof makeVp8BoolDecoder>,
          plane: number,
          firstCoeff: number,
          initCtx: number
        ): number => {
          let ctx = initCtx;
          let n = firstCoeff;
          for (; n < 16; n++) {
            let pBase = ((plane * 8 + kCoeffBands[n]) * 3 + ctx) * 11;
            if (dbr.readBit(coeffProbs[pBase]) === 0) {
              return n;
            }
            while (dbr.readBit(coeffProbs[pBase + 1]) === 0) {
              n++;
              if (n === 16) return 16;
              pBase = ((plane * 8 + kCoeffBands[n]) * 3 + 0) * 11;
            }
            if (dbr.readBit(coeffProbs[pBase + 2]) === 0) {
              ctx = 1;
            } else {
              ctx = 2;
              if (dbr.readBit(coeffProbs[pBase + 3]) === 0) {
                if (dbr.readBit(coeffProbs[pBase + 4]) === 1) {
                  dbr.readBit(coeffProbs[pBase + 5]);
                }
              } else {
                if (dbr.readBit(coeffProbs[pBase + 6]) === 0) {
                  const b7 = dbr.readBit(coeffProbs[pBase + 7]);
                  for (const cp of kCatProbs[b7]) {
                    dbr.readBit(cp);
                  }
                } else {
                  const bit1 = dbr.readBit(coeffProbs[pBase + 8]);
                  const bit2 = dbr.readBit(coeffProbs[pBase + 9 + bit1]);
                  for (const cp of kCatProbs[2 + (bit1 << 1) + bit2]) {
                    dbr.readBit(cp);
                  }
                }
              }
            }
            dbr.readBit(128);
          }
          return 16;
        };

        const topModes = new Uint8Array(mbW * 4);
        const topNz = new Uint8Array(mbW * 9);
        for (let my = 0; my < mbH; my++) {
          const leftModes = new Uint8Array(4);
          const leftNz = new Uint8Array(9);
          const dbr = dctBrs[my & (numDctPartitions - 1)];
          for (let mx = 0; mx < mbW; mx++) {
            if (segEnabled === 1 && updateMap === 1) {
              const s0 = bd.readBit(segTreeProbs[0]);
              bd.readBit(segTreeProbs[s0 + 1]);
            }
            let skip = 0;
            if (mbNoSkipCoeff === 1) {
              skip = bd.readBit(probSkipFalse);
            }
            let ymode = 0;
            if (bd.readBit(145) === 0) {
              ymode = 4;
            } else if (bd.readBit(156) === 0) {
              ymode = bd.readBit(163) === 0 ? 0 : 1;
            } else {
              ymode = bd.readBit(128) === 0 ? 2 : 3;
            }
            if (ymode === 4) {
              for (let by = 0; by < 4; by++) {
                let left = leftModes[by];
                for (let bx = 0; bx < 4; bx++) {
                  const above = topModes[mx * 4 + bx];
                  const baseIdx = (above * 10 + left) * 9;
                  let idx = 0;
                  while (true) {
                    const b = bd.readBit(kKfBmodeProb[baseIdx + (idx >>> 1)]);
                    idx = bModeTree[idx + b];
                    if (idx < 0) {
                      left = -idx - 1;
                      break;
                    }
                  }
                  topModes[mx * 4 + bx] = left;
                }
                leftModes[by] = left;
              }
            } else {
              const fill = ymode === 0 ? 0 : ymode === 1 ? 2 : ymode === 2 ? 3 : 1;
              for (let k = 0; k < 4; k++) {
                topModes[mx * 4 + k] = fill;
                leftModes[k] = fill;
              }
            }
            if (bd.readBit(142) === 1) {
              if (bd.readBit(114) === 1) bd.readBit(183);
            }
            if (bd.isEof()) return false;

            if (skip === 1) {
              for (let k = 0; k < 8; k++) {
                topNz[mx * 9 + k] = 0;
                leftNz[k] = 0;
              }
              if (ymode !== 4) {
                topNz[mx * 9 + 8] = 0;
                leftNz[8] = 0;
              }
            } else {
              if (ymode !== 4) {
                const nzY2 =
                  decodeBlock(dbr, 1, 0, topNz[mx * 9 + 8] + leftNz[8]) > 0 ? 1 : 0;
                topNz[mx * 9 + 8] = nzY2;
                leftNz[8] = nzY2;
              }
              const yPlane = ymode === 4 ? 3 : 0;
              const yFirst = ymode === 4 ? 0 : 1;
              for (let by = 0; by < 4; by++) {
                let l = leftNz[by];
                for (let bx = 0; bx < 4; bx++) {
                  const a = topNz[mx * 9 + bx];
                  const nz =
                    decodeBlock(dbr, yPlane, yFirst, a + l) > yFirst ? 1 : 0;
                  l = nz;
                  topNz[mx * 9 + bx] = nz;
                }
                leftNz[by] = l;
              }
              for (let ch = 0; ch < 2; ch++) {
                for (let by = 0; by < 2; by++) {
                  let l = leftNz[4 + ch * 2 + by];
                  for (let bx = 0; bx < 2; bx++) {
                    const a = topNz[mx * 9 + 4 + ch * 2 + bx];
                    const nz = decodeBlock(dbr, 2, 0, a + l) > 0 ? 1 : 0;
                    l = nz;
                    topNz[mx * 9 + 4 + ch * 2 + bx] = nz;
                  }
                  leftNz[4 + ch * 2 + by] = l;
                }
              }
            }
            if (dbr.isEof()) return false;
          }
        }
        return true;
      };

      const isValidVp8lPayload = (
        payload: Buffer,
        expectedW?: number,
        expectedH?: number
      ): boolean => {
        if (payload.length < 12) return false;
        if (payload[0] !== 0x2f) return false;
        const bits = payload.readUInt32LE(1);
        const mainW = (bits & 0x3fff) + 1;
        const mainH = ((bits >>> 14) & 0x3fff) + 1;
        const version = (bits >>> 29) & 0x7;
        if (mainW <= 0 || mainH <= 0 || version !== 0) return false;
        if (
          expectedW !== undefined &&
          expectedH !== undefined &&
          (mainW !== expectedW || mainH !== expectedH)
        ) {
          return false;
        }

        let bitPos = 40;
        const totalBits = payload.length * 8;
        const readBits = (n: number): number => {
          if (n === 0) return 0;
          if (bitPos + n > totalBits) return -1;
          let val = 0;
          for (let i = 0; i < n; i++) {
            const byteIdx = (bitPos + i) >>> 3;
            const bitIdx = (bitPos + i) & 7;
            val |= ((payload[byteIdx] >>> bitIdx) & 1) << i;
          }
          bitPos += n;
          return val;
        };

        type HuffNode = {
          left: HuffNode | null;
          right: HuffNode | null;
          symbol: number;
        };
        type HuffTree = {
          single: boolean;
          symbol: number;
          root: HuffNode | null;
        };

        const buildHuffmanTree = (codeLengths: Int32Array): HuffTree | null => {
          const count = new Int32Array(16);
          let nonZeroCount = 0;
          let singleSym = -1;
          for (let s = 0; s < codeLengths.length; s++) {
            const len = codeLengths[s];
            if (len < 0 || len > 15) return null;
            if (len > 0) {
              count[len]++;
              nonZeroCount++;
              singleSym = s;
            }
          }
          if (nonZeroCount === 0) return null;
          if (nonZeroCount === 1) {
            return { single: true, symbol: singleSym, root: null };
          }
          let kraft = 0;
          for (let b = 1; b <= 15; b++) {
            kraft += count[b] * (1 << (15 - b));
          }
          if (kraft !== 32768) return null;

          const nextCode = new Int32Array(16);
          let code = 0;
          for (let b = 1; b <= 15; b++) {
            code = (code + count[b - 1]) << 1;
            nextCode[b] = code;
          }
          const root: HuffNode = { left: null, right: null, symbol: -1 };
          for (let s = 0; s < codeLengths.length; s++) {
            const len = codeLengths[s];
            if (len > 0) {
              const c = nextCode[len]++;
              let node = root;
              for (let b = len - 1; b >= 0; b--) {
                const bit = (c >>> b) & 1;
                if (bit === 0) {
                  if (!node.left) node.left = { left: null, right: null, symbol: -1 };
                  node = node.left;
                } else {
                  if (!node.right) node.right = { left: null, right: null, symbol: -1 };
                  node = node.right;
                }
              }
              node.symbol = s;
            }
          }
          return { single: false, symbol: -1, root };
        };

        const decodeSymbol = (tree: HuffTree): number => {
          if (tree.single) return tree.symbol;
          let node = tree.root;
          while (node && node.symbol < 0) {
            const bit = readBits(1);
            if (bit < 0) return -1;
            node = bit === 0 ? node.left : node.right;
          }
          return node ? node.symbol : -1;
        };

        const kCodeLengthCodeOrder = [
          17, 18, 0, 1, 2, 3, 4, 5, 16, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
        ];

        const readPrefixCode = (alphabetSize: number): HuffTree | null => {
          const simple = readBits(1);
          if (simple < 0) return null;
          if (simple === 1) {
            const numSymbols = readBits(1) + 1;
            const isFirst8 = readBits(1);
            if (numSymbols < 1 || isFirst8 < 0) return null;
            const s0 = readBits(isFirst8 ? 8 : 1);
            if (s0 < 0 || s0 >= alphabetSize) return null;
            if (numSymbols === 1) {
              return { single: true, symbol: s0, root: null };
            }
            const s1 = readBits(8);
            if (s1 < 0 || s1 >= alphabetSize || s1 === s0) return null;
            return {
              single: false,
              symbol: -1,
              root: {
                left: { left: null, right: null, symbol: s0 },
                right: { left: null, right: null, symbol: s1 },
                symbol: -1,
              },
            };
          }

          const numCodeLengths = readBits(4) + 4;
          if (numCodeLengths < 4 || numCodeLengths > 19) return null;
          const clCodeLengths = new Int32Array(19);
          for (let i = 0; i < numCodeLengths; i++) {
            const len = readBits(3);
            if (len < 0) return null;
            clCodeLengths[kCodeLengthCodeOrder[i]] = len;
          }
          const clTree = buildHuffmanTree(clCodeLengths);
          if (!clTree) return null;

          const hasMaxSymbol = readBits(1);
          if (hasMaxSymbol < 0) return null;
          let maxSymbol = alphabetSize;
          if (hasMaxSymbol === 1) {
            const lengthNbits = 2 + 2 * readBits(3);
            if (lengthNbits < 2) return null;
            const maxSymBits = readBits(lengthNbits);
            if (maxSymBits < 0) return null;
            maxSymbol = 2 + maxSymBits;
            if (maxSymbol > alphabetSize) return null;
          }

          const symbolCodeLengths = new Int32Array(alphabetSize);
          let prevCodeLen = 8;
          let symbol = 0;
          let remaining = maxSymbol;
          while (symbol < alphabetSize && remaining-- > 0) {
            const codeLen = decodeSymbol(clTree);
            if (codeLen < 0) return null;
            if (codeLen < 16) {
              symbolCodeLengths[symbol++] = codeLen;
              if (codeLen !== 0) prevCodeLen = codeLen;
            } else if (codeLen === 16) {
              const extra = readBits(2);
              if (extra < 0) return null;
              const rep = 3 + extra;
              if (symbol + rep > alphabetSize) return null;
              for (let k = 0; k < rep; k++) symbolCodeLengths[symbol++] = prevCodeLen;
            } else if (codeLen === 17) {
              const extra = readBits(3);
              if (extra < 0) return null;
              const rep = 3 + extra;
              if (symbol + rep > alphabetSize) return null;
              symbol += rep;
            } else if (codeLen === 18) {
              const extra = readBits(7);
              if (extra < 0) return null;
              const rep = 11 + extra;
              if (symbol + rep > alphabetSize) return null;
              symbol += rep;
            } else {
              return null;
            }
          }
          return buildHuffmanTree(symbolCodeLengths);
        };

        const decodeImageStream = (
          imgW: number,
          imgH: number,
          isSubImage: boolean
        ): Uint32Array | null => {
          const useColorCache = readBits(1);
          if (useColorCache < 0) return null;
          let cacheBits = 0;
          if (useColorCache === 1) {
            cacheBits = readBits(4);
            if (cacheBits < 1 || cacheBits > 11) return null;
          }
          let numHtreeGroups = 1;
          let prefixBits = 0;
          let metaPixels: Uint32Array | null = null;
          let metaW = 0;
          if (!isSubImage) {
            const useMeta = readBits(1);
            if (useMeta < 0) return null;
            if (useMeta === 1) {
              const pb = readBits(3);
              if (pb < 0) return null;
              prefixBits = pb + 2;
              metaW = (imgW + (1 << prefixBits) - 1) >>> prefixBits;
              const metaH = (imgH + (1 << prefixBits) - 1) >>> prefixBits;
              metaPixels = decodeImageStream(metaW, metaH, true);
              if (!metaPixels) return null;
              for (let i = 0; i < metaPixels.length; i++) {
                const g = (metaPixels[i] >>> 8) & 0xffff;
                if (g + 1 > numHtreeGroups) numHtreeGroups = g + 1;
              }
            }
          }
          const alphabetSizes = [
            256 + 24 + (cacheBits > 0 ? 1 << cacheBits : 0),
            256,
            256,
            256,
            40,
          ];
          const groups: HuffTree[][] = [];
          for (let g = 0; g < numHtreeGroups; g++) {
            const trees: HuffTree[] = [];
            for (const sz of alphabetSizes) {
              const t = readPrefixCode(sz);
              if (!t) return null;
              trees.push(t);
            }
            groups.push(trees);
          }

          const totalPixels = imgW * imgH;
          if (totalPixels <= 0 || totalPixels > 4096 * 4096) return null;
          const pixels = new Uint32Array(totalPixels);
          const colorCache =
            cacheBits > 0 ? new Uint32Array(1 << cacheBits) : null;
          const cacheShift = 32 - cacheBits;
          const kCodeToPlane = [
            0x18, 0x07, 0x17, 0x19, 0x28, 0x06, 0x27, 0x29, 0x16, 0x1a, 0x26, 0x2a, 0x38, 0x05, 0x37, 0x39,
            0x15, 0x1b, 0x36, 0x3a, 0x25, 0x2b, 0x48, 0x04, 0x47, 0x49, 0x14, 0x1c, 0x35, 0x3b, 0x46, 0x4a,
            0x24, 0x2c, 0x58, 0x13, 0x1d, 0x45, 0x4b, 0x34, 0x3c, 0x03, 0x57, 0x59, 0x23, 0x2d, 0x56, 0x5a,
            0x12, 0x1e, 0x33, 0x3d, 0x44, 0x4c, 0x55, 0x5b, 0x02, 0x68, 0x11, 0x1f, 0x67, 0x69, 0x22, 0x2e,
            0x66, 0x6a, 0x32, 0x3e, 0x43, 0x4d, 0x54, 0x5c, 0x65, 0x6b, 0x10, 0x21, 0x2f, 0x31, 0x3f, 0x42,
            0x4e, 0x53, 0x5d, 0x01, 0x64, 0x6c, 0x78, 0x77, 0x79, 0x20, 0x30, 0x41, 0x4f, 0x52, 0x5e, 0x63,
            0x6d, 0x76, 0x7a, 0x40, 0x51, 0x5f, 0x62, 0x6e, 0x75, 0x7b, 0x50, 0x61, 0x6f, 0x74, 0x7c, 0x60,
            0x73, 0x7d, 0x72, 0x7e, 0x71, 0x7f, 0x70, 0x00,
          ];
          let idx = 0;
          while (idx < totalPixels) {
            let groupIdx = 0;
            if (metaPixels) {
              const x = idx % imgW;
              const y = (idx / imgW) | 0;
              const metaIdx = (y >>> prefixBits) * metaW + (x >>> prefixBits);
              groupIdx = (metaPixels[metaIdx] >>> 8) & 0xffff;
              if (groupIdx >= groups.length) return null;
            }
            const [greenTree, redTree, blueTree, alphaTree, distTree] = groups[groupIdx];
            const s = decodeSymbol(greenTree);
            if (s < 0) return null;
            if (s < 256) {
              const r = decodeSymbol(redTree);
              const b = decodeSymbol(blueTree);
              const a = decodeSymbol(alphaTree);
              if (r < 0 || b < 0 || a < 0) return null;
              const argb =
                (((a & 0xff) << 24) | ((r & 0xff) << 16) | ((s & 0xff) << 8) | (b & 0xff)) >>> 0;
              pixels[idx++] = argb;
              if (colorCache) {
                colorCache[Math.imul(argb, 0x1e35a7bd) >>> cacheShift] = argb;
              }
            } else if (s < 280) {
              const lengthCode = s - 256;
              let length = 0;
              if (lengthCode < 4) {
                length = lengthCode + 1;
              } else {
                const extraBits = (lengthCode - 2) >>> 1;
                const offset = (2 + (lengthCode & 1)) << extraBits;
                const extra = readBits(extraBits);
                if (extra < 0) return null;
                length = offset + extra + 1;
              }
              const distCode = decodeSymbol(distTree);
              if (distCode < 0) return null;
              let distSymbol = 0;
              if (distCode < 4) {
                distSymbol = distCode + 1;
              } else {
                const distExtraBits = (distCode - 2) >>> 1;
                const distOffset = (2 + (distCode & 1)) << distExtraBits;
                const distExtra = readBits(distExtraBits);
                if (distExtra < 0) return null;
                distSymbol = distOffset + distExtra + 1;
              }
              let dist = 1;
              if (distSymbol > 120) {
                dist = distSymbol - 120;
              } else {
                const planeCode = kCodeToPlane[distSymbol - 1];
                const yoffset = planeCode >>> 4;
                const xoffset = 8 - (planeCode & 0x0f);
                const d = yoffset * imgW + xoffset;
                dist = d >= 1 ? d : 1;
              }
              if (dist > idx || idx + length > totalPixels) return null;
              for (let k = 0; k < length; k++) {
                const argb = pixels[idx - dist];
                pixels[idx++] = argb;
                if (colorCache) {
                  colorCache[Math.imul(argb, 0x1e35a7bd) >>> cacheShift] = argb;
                }
              }
            } else {
              if (!colorCache) return null;
              const cacheIdx = s - 280;
              if (cacheIdx < 0 || cacheIdx >= colorCache.length) return null;
              const argb = colorCache[cacheIdx];
              pixels[idx++] = argb;
              colorCache[Math.imul(argb, 0x1e35a7bd) >>> cacheShift] = argb;
            }
          }
          return pixels;
        };

        let curW = mainW;
        const seenTransforms = new Set<number>();
        while (true) {
          const trPresent = readBits(1);
          if (trPresent < 0) return false;
          if (trPresent === 0) break;
          const trType = readBits(2);
          if (trType < 0 || seenTransforms.has(trType)) return false;
          seenTransforms.add(trType);
          if (trType === 0 || trType === 1) {
            const sb = readBits(3);
            if (sb < 0) return false;
            const sizeBits = sb + 2;
            const trW = (curW + (1 << sizeBits) - 1) >>> sizeBits;
            const trH = (mainH + (1 << sizeBits) - 1) >>> sizeBits;
            if (!decodeImageStream(trW, trH, true)) return false;
          } else if (trType === 2) {
            // Subtract green transform has no extra data
          } else if (trType === 3) {
            const numColors = readBits(8);
            if (numColors < 0) return false;
            const colorTableSize = numColors + 1;
            if (!decodeImageStream(colorTableSize, 1, true)) return false;
            const bitsPerPixel =
              colorTableSize <= 2 ? 1 : colorTableSize <= 4 ? 2 : colorTableSize <= 16 ? 4 : 8;
            const xbits = 8 / bitsPerPixel;
            curW = Math.ceil(curW / xbits);
          }
        }

        if (!decodeImageStream(curW, mainH, false)) return false;
        return bitPos <= totalBits;
      };

      const chunkFourCC = buf.subarray(12, 16).toString("ascii");
      const chunkSize = buf.readUInt32LE(16);
      const paddedChunkSize = chunkSize + (chunkSize % 2);
      if (chunkSize <= 0 || 20 + paddedChunkSize > buf.length) return false;

      if (chunkFourCC === "VP8 ") {
        return isValidVp8Payload(buf.subarray(20, 20 + paddedChunkSize));
      }
      if (chunkFourCC === "VP8L") {
        return isValidVp8lPayload(buf.subarray(20, 20 + paddedChunkSize));
      }
      if (chunkFourCC === "VP8X") {
        if (chunkSize !== 10 || buf.length < 38) return false;
        if ((buf[20] & 0xc1) !== 0 || buf[21] !== 0 || buf[22] !== 0 || buf[23] !== 0) {
          return false;
        }
        const canvasW = (buf[24] | (buf[25] << 8) | (buf[26] << 16)) + 1;
        const canvasH = (buf[27] | (buf[28] << 8) | (buf[29] << 16)) + 1;
        if (canvasW <= 0 || canvasH <= 0) return false;

        let offset = 30;
        let hasValidImageChunk = false;
        const allowedChunks = new Set([
          "ICCP",
          "ALPH",
          "VP8 ",
          "VP8L",
          "EXIF",
          "XMP ",
          "ANIM",
          "ANMF",
        ]);
        while (offset < buf.length) {
          if (offset + 8 > buf.length) return false;
          const cFourCC = buf.subarray(offset, offset + 4).toString("ascii");
          const cSize = buf.readUInt32LE(offset + 4);
          const paddedCSize = cSize + (cSize % 2);
          if (
            !allowedChunks.has(cFourCC) ||
            cSize <= 0 ||
            offset + 8 + paddedCSize > buf.length
          ) {
            return false;
          }
          const cPayload = buf.subarray(offset + 8, offset + 8 + cSize);
          if (cFourCC === "VP8 ") {
            const cVp8Slice = buf.subarray(offset + 8, offset + 8 + paddedCSize);
            if (!isValidVp8Payload(cVp8Slice, canvasW, canvasH)) return false;
            hasValidImageChunk = true;
          } else if (cFourCC === "VP8L") {
            const cVp8lSlice = buf.subarray(offset + 8, offset + 8 + paddedCSize);
            if (!isValidVp8lPayload(cVp8lSlice, canvasW, canvasH)) return false;
            hasValidImageChunk = true;
          } else if (cFourCC === "ALPH") {
            if (cPayload.length < 2 || (cPayload[0] & 0xc0) !== 0) return false;
            const alphComp = cPayload[0] & 3;
            if (alphComp > 1) return false;
            if (alphComp === 0 && cPayload.length !== 1 + canvasW * canvasH) {
              return false;
            }
            if (alphComp === 1) {
              const fakeVp8lHdr = Buffer.alloc(5);
              fakeVp8lHdr[0] = 0x2f;
              const dimBits =
                ((canvasW - 1) & 0x3fff) | (((canvasH - 1) & 0x3fff) << 14);
              fakeVp8lHdr.writeUInt32LE(dimBits >>> 0, 1);
              if (
                !isValidVp8lPayload(
                  Buffer.concat([fakeVp8lHdr, cPayload.subarray(1)]),
                  canvasW,
                  canvasH
                )
              ) {
                return false;
              }
            }
          }
          offset += 8 + cSize + (cSize % 2);
        }
        return hasValidImageChunk;
      }
      return false;
    }
    case ".pdf": {
      // "%PDF-" header, valid indirect object graph (/Catalog -> /Pages -> /Page) outside comments/strings/nested dicts, and trailing "%%EOF"
      if (buf.length < 64 || buf.subarray(0, 5).toString("ascii") !== "%PDF-") {
        return false;
      }
      const text = buf.toString("latin1");
      const eofIdx = text.lastIndexOf("%%EOF");
      if (eofIdx < 0) return false;
      const rawPdfBody = text.slice(0, eofIdx);

      const validateRawPdfDict = (blob: string): boolean => {
        const isWs = (c: string): boolean =>
          c === "\x00" ||
          c === "\t" ||
          c === "\n" ||
          c === "\f" ||
          c === "\r" ||
          c === " ";
        const isDelim = (c: string): boolean => "()<>[]{}/%".includes(c);
        let idx = 0;
        const skip = (): void => {
          while (idx < blob.length) {
            if (isWs(blob[idx])) {
              idx++;
            } else if (blob[idx] === "%") {
              while (
                idx < blob.length &&
                blob[idx] !== "\n" &&
                blob[idx] !== "\r"
              ) {
                idx++;
              }
            } else {
              break;
            }
          }
        };
        const parseVal = (): string | null => {
          skip();
          if (idx >= blob.length) return null;
          if (blob.startsWith("<<", idx)) {
            idx += 2;
            const keys = new Set<string>();
            while (true) {
              skip();
              if (idx >= blob.length) return null;
              if (blob.startsWith(">>", idx)) {
                idx += 2;
                return "DICT";
              }
              if (blob[idx] !== "/") return null;
              idx++;
              const ks = idx;
              while (
                idx < blob.length &&
                !isWs(blob[idx]) &&
                !isDelim(blob[idx])
              ) {
                idx++;
              }
              const k = blob.slice(ks, idx);
              if (keys.has(k)) return null;
              keys.add(k);
              if (!parseVal()) return null;
            }
          }
          if (blob[idx] === "[") {
            idx++;
            while (true) {
              skip();
              if (idx >= blob.length) return null;
              if (blob[idx] === "]") {
                idx++;
                return "ARRAY";
              }
              if (!parseVal()) return null;
            }
          }
          if (blob[idx] === "(") {
            idx++;
            let depth = 1;
            while (idx < blob.length && depth > 0) {
              const ch = blob[idx++];
              if (ch === "\\") idx++;
              else if (ch === "(") depth++;
              else if (ch === ")") depth--;
            }
            return depth === 0 ? "STRING" : null;
          }
          if (blob[idx] === "<") {
            idx++;
            while (idx < blob.length && blob[idx] !== ">") {
              if (!isWs(blob[idx]) && !/[0-9A-Fa-f]/.test(blob[idx])) {
                return null;
              }
              idx++;
            }
            if (idx >= blob.length) return null;
            idx++;
            return "STRING";
          }
          if (blob[idx] === "/") {
            idx++;
            while (
              idx < blob.length &&
              !isWs(blob[idx]) &&
              !isDelim(blob[idx])
            ) {
              idx++;
            }
            return "NAME";
          }
          if (isDelim(blob[idx])) return null;
          const ts = idx;
          while (
            idx < blob.length &&
            !isWs(blob[idx]) &&
            !isDelim(blob[idx])
          ) {
            idx++;
          }
          const tok = blob.slice(ts, idx);
          if (/^[+-]?\d+$/.test(tok)) {
            const saved = idx;
            skip();
            const rm =
              /^(\d+)[\x00\t\n\f\r ]+R(?=[\x00\t\n\f\r ()<>\[\]{}/%]|$)/.exec(
                blob.slice(idx)
              );
            if (/^\d+$/.test(tok) && rm) {
              idx += rm[0].length;
              return "REF";
            }
            idx = saved;
            return "INT";
          }
          if (/^[+-]?(?:\d+\.\d*|\.\d+)$/.test(tok)) return "REAL";
          if (tok === "true" || tok === "false") return "BOOL";
          if (tok === "null") return "NULL";
          return null;
        };
        const rootKind = parseVal();
        skip();
        return rootKind === "DICT" && idx === blob.length;
      };

      const extractDirectDictWithSpan = (
        src: string,
        startIdx = 0
      ): { content: string; openIdx: number; closeIdx: number } | null => {
        const openIdx = src.indexOf("<<", startIdx);
        if (openIdx < 0) return null;
        let dictDepth = 1;
        let parenDepth = 0;
        let bracketDepth = 0;
        let hexDepth = 0;
        let i = openIdx + 2;
        const out: string[] = [];
        while (i < src.length && dictDepth > 0) {
          const ch = src[i];
          if (parenDepth > 0) {
            if (ch === "\\") {
              i += 2;
              out.push(bracketDepth >= 1 ? "@@" : "  ");
              continue;
            }
            if (ch === "(") parenDepth++;
            else if (ch === ")") parenDepth--;
            out.push(bracketDepth >= 1 ? "@" : " ");
            i++;
            continue;
          }
          if (hexDepth > 0) {
            if (ch === ">") {
              hexDepth = 0;
            }
            out.push(bracketDepth >= 1 ? "@" : " ");
            i++;
            continue;
          }
          if (ch === "(") {
            parenDepth = 1;
            out.push(bracketDepth >= 1 ? "@" : "()");
            i++;
            continue;
          }
          if (ch === "<" && src[i + 1] === "<") {
            dictDepth++;
            out.push(
              bracketDepth >= 1 ? "@@" : dictDepth === 2 ? "<<>>" : "  "
            );
            i += 2;
            continue;
          }
          if (ch === ">" && src[i + 1] === ">") {
            dictDepth--;
            if (dictDepth === 0) {
              if (!validateRawPdfDict(src.slice(openIdx, i + 2))) {
                return null;
              }
              return { content: out.join(""), openIdx, closeIdx: i + 2 };
            }
            out.push(bracketDepth >= 1 ? "@@" : "  ");
            i += 2;
            continue;
          }
          if (ch === "<") {
            hexDepth = 1;
            out.push(bracketDepth >= 1 ? "@" : "<>");
            i++;
            continue;
          }
          if (dictDepth === 1) {
            if (ch === "[") {
              bracketDepth++;
              out.push(bracketDepth === 1 ? "[" : "@");
              i++;
              continue;
            }
            if (ch === "]") {
              out.push(bracketDepth === 1 ? "]" : "@");
              if (bracketDepth > 0) bracketDepth--;
              i++;
              continue;
            }
            out.push(bracketDepth <= 1 ? ch : "@");
          } else {
            out.push(bracketDepth >= 1 ? "@" : " ");
          }
          i++;
        }
        return null;
      };

      const extractDirectDictContent = (src: string, startIdx = 0): string | null => {
        const res = extractDirectDictWithSpan(src, startIdx);
        return res ? res.content : null;
      };

      const stripDirectArrays = (dict: string): string => dict.replace(/\[[^\]]*\]/g, "[]");

      type PdfDictVal =
        | { kind: "INT"; value: number }
        | { kind: "REAL"; value: number }
        | { kind: "REF"; num: number; gen: number }
        | { kind: "NAME"; value: string }
        | { kind: "BOOL"; value: boolean }
        | { kind: "NULL" }
        | { kind: "COMPOSITE"; value: string };

      const parsePdfDictEntries = (
        scalarDict: string
      ): Array<{ key: string; val: PdfDictVal }> | null => {
        const isPdfWs = (c: string): boolean =>
          c === "\x00" ||
          c === "\t" ||
          c === "\n" ||
          c === "\f" ||
          c === "\r" ||
          c === " ";
        const isPdfDelim = (c: string): boolean => "()<>[]{}/%".includes(c);

        const tokens: string[] = [];
        let idx = 0;
        while (idx < scalarDict.length) {
          while (idx < scalarDict.length && isPdfWs(scalarDict[idx])) {
            idx++;
          }
          if (idx >= scalarDict.length) break;
          if (scalarDict.startsWith("<<>>", idx)) {
            tokens.push("<<>>");
            idx += 4;
            continue;
          }
          if (
            scalarDict.startsWith("[]", idx) ||
            scalarDict.startsWith("()", idx) ||
            scalarDict.startsWith("<>", idx)
          ) {
            tokens.push(scalarDict.slice(idx, idx + 2));
            idx += 2;
            continue;
          }
          if (scalarDict[idx] === "/") {
            const start = idx++;
            while (
              idx < scalarDict.length &&
              !isPdfWs(scalarDict[idx]) &&
              !isPdfDelim(scalarDict[idx])
            ) {
              idx++;
            }
            tokens.push(scalarDict.slice(start, idx));
            continue;
          }
          if (isPdfDelim(scalarDict[idx])) {
            return null;
          }
          const start = idx;
          while (
            idx < scalarDict.length &&
            !isPdfWs(scalarDict[idx]) &&
            !isPdfDelim(scalarDict[idx])
          ) {
            idx++;
          }
          tokens.push(scalarDict.slice(start, idx));
        }

        const entries: Array<{ key: string; val: PdfDictVal }> = [];
        const seenKeys = new Set<string>();
        let ti = 0;
        while (ti < tokens.length) {
          const key = tokens[ti++];
          if (
            !key.startsWith("/") ||
            seenKeys.has(key) ||
            ti >= tokens.length
          ) {
            return null;
          }
          seenKeys.add(key);
          const t0 = tokens[ti];
          if (
            /^\d+$/.test(t0) &&
            ti + 2 < tokens.length &&
            /^\d+$/.test(tokens[ti + 1]) &&
            tokens[ti + 2] === "R"
          ) {
            entries.push({
              key,
              val: {
                kind: "REF",
                num: Number(t0),
                gen: Number(tokens[ti + 1]),
              },
            });
            ti += 3;
            continue;
          }
          ti++;
          if (/^[+-]?\d+$/.test(t0)) {
            entries.push({ key, val: { kind: "INT", value: Number(t0) } });
          } else if (
            /^[+-]?(?:\d+\.\d*|\.\d+)$/.test(t0)
          ) {
            entries.push({ key, val: { kind: "REAL", value: Number(t0) } });
          } else if (t0.startsWith("/")) {
            entries.push({ key, val: { kind: "NAME", value: t0 } });
          } else if (t0 === "true" || t0 === "false") {
            entries.push({ key, val: { kind: "BOOL", value: t0 === "true" } });
          } else if (t0 === "null") {
            entries.push({ key, val: { kind: "NULL" } });
          } else if (
            t0 === "[]" ||
            t0 === "<<>>" ||
            t0 === "()" ||
            t0 === "<>"
          ) {
            entries.push({ key, val: { kind: "COMPOSITE", value: t0 } });
          } else {
            return null;
          }
        }
        return entries;
      };

      const pendingLengthRefs: Array<{ num: number; gen: number; len: number }> = [];
      const maskedChars: string[] = [];
      {
        let p = 0;
        let parenDepth = 0;
        while (p < rawPdfBody.length) {
          const ch = rawPdfBody[p];
          if (parenDepth > 0) {
            if (ch === "\\") {
              maskedChars.push("  ");
              p += 2;
              continue;
            }
            if (ch === "(") parenDepth++;
            else if (ch === ")") parenDepth--;
            maskedChars.push(parenDepth === 0 ? ")" : " ");
            p++;
            continue;
          }
          if (ch === "(") {
            parenDepth = 1;
            maskedChars.push("(");
            p++;
            continue;
          }
          if (ch === "%" && !(p === 0 && rawPdfBody.startsWith("%PDF-"))) {
            while (p < rawPdfBody.length && rawPdfBody[p] !== "\r" && rawPdfBody[p] !== "\n") {
              maskedChars.push(" ");
              p++;
            }
            continue;
          }
          if (
            ch === "s" &&
            (p === 0 || !/[A-Za-z0-9_\/]/.test(rawPdfBody[p - 1])) &&
            rawPdfBody.startsWith("stream", p) &&
            (rawPdfBody[p + 6] === "\n" || rawPdfBody[p + 6] === "\r")
          ) {
            const priorText = maskedChars.join("");
            const lastObjRegex = /(?:^|[\r\n\s])(\d+\s+\d+\s+obj\b)/g;
            let lastObjIdx = -1;
            let lastObjHeaderEnd = -1;
            let om: RegExpExecArray | null;
            while ((om = lastObjRegex.exec(priorText)) !== null) {
              lastObjIdx = om.index;
              lastObjHeaderEnd = om.index + om[0].length;
            }
            if (lastObjIdx < 0 || /\bendobj\b/.test(priorText.slice(lastObjIdx))) {
              return false;
            }
            const streamDictSpan = extractDirectDictWithSpan(priorText, lastObjHeaderEnd);
            if (!streamDictSpan) return false;
            if (
              priorText.slice(lastObjHeaderEnd, streamDictSpan.openIdx).trim() !== "" ||
              priorText.slice(streamDictSpan.closeIdx).trim() !== ""
            ) {
              return false;
            }
            const scalarStreamDict = stripDirectArrays(streamDictSpan.content);
            const streamEntries = parsePdfDictEntries(scalarStreamDict);
            if (!streamEntries) return false;
            const lengthEntries = streamEntries.filter((e) => e.key === "/Length");
            if (lengthEntries.length !== 1) return false;
            let streamLen: number | null = null;
            const lenVal = lengthEntries[0].val;
            if (lenVal.kind === "INT") {
              if (lenVal.value < 0) return false;
              streamLen = lenVal.value;
            } else if (lenVal.kind === "REF") {
              const refNum = lenVal.num;
              const refGen = lenVal.gen;
              const lenObjRe = new RegExp(
                `(?:^|[\\r\\n\\s])${refNum}\\s+${refGen}\\s+obj\\s+(\\d+)\\s+endobj\\b`
              );
              const lenObjMatch =
                lenObjRe.exec(priorText) || lenObjRe.exec(rawPdfBody);
              if (lenObjMatch) {
                streamLen = Number(lenObjMatch[1]);
                pendingLengthRefs.push({
                  num: refNum,
                  gen: refGen,
                  len: streamLen,
                });
              }
            }
            if (streamLen === null || !Number.isInteger(streamLen) || streamLen < 0) {
              return false;
            }
            const eolAfterStream =
              rawPdfBody[p + 6] === "\r" && rawPdfBody[p + 7] === "\n" ? 2 : 1;
            const dataStart = p + 6 + eolAfterStream;
            const dataEnd = dataStart + streamLen;
            if (dataEnd > rawPdfBody.length) return false;
            const afterData = rawPdfBody.slice(dataEnd);
            const endStreamMatch = /^(\r\n|\n|\r)?endstream(?![A-Za-z0-9_\/])/.exec(afterData);
            if (!endStreamMatch) return false;
            const afterEndStream = afterData.slice(endStreamMatch[0].length);
            if (!/^(?:\s|%[^\r\n]*)*endobj(?![A-Za-z0-9_\/])/.test(afterEndStream)) {
              return false;
            }
            maskedChars.push("stream\nendstream");
            p = dataEnd + endStreamMatch[0].length;
            continue;
          }
          maskedChars.push(ch);
          p++;
        }
        if (parenDepth !== 0) return false;
      }
      const bodyWithoutComments = maskedChars.join("");

      for (const reqRef of pendingLengthRefs) {
        const verifiedLenRe = new RegExp(
          `(?:^|[\\r\\n\\s])${reqRef.num}\\s+${reqRef.gen}\\s+obj\\s+${reqRef.len}\\s+endobj\\b`
        );
        if (!verifiedLenRe.test(bodyWithoutComments)) {
          return false;
        }
      }

      const objects = new Map<string, string>();
      const seenObjKeys = new Set<string>();
      const objRegex = /(?:^|[\r\n\s])(\d+)\s+(\d+)\s+obj\b([\s\S]*?)\bendobj\b/g;
      let match: RegExpExecArray | null;
      while ((match = objRegex.exec(bodyWithoutComments)) !== null) {
        const objKey = `${Number(match[1])}:${Number(match[2])}`;
        if (seenObjKeys.has(objKey)) {
          return false;
        }
        seenObjKeys.add(objKey);
        const span = extractDirectDictWithSpan(match[3], 0);
        if (span !== null) {
          const beforeDict = match[3].slice(0, span.openIdx).trim();
          const afterDict = match[3].slice(span.closeIdx).trim();
          if (
            beforeDict === "" &&
            (afterDict === "" || afterDict === "stream\nendstream")
          ) {
            objects.set(objKey, span.content);
          } else {
            return false;
          }
        }
      }
      if (objects.size === 0) return false;

      const candidateCatalogKeys: string[] = [];
      const trailerMatch = /(?:^|[\r\n\s])trailer\b/g;
      let lastTrailerIdx = -1;
      let tm: RegExpExecArray | null;
      while ((tm = trailerMatch.exec(bodyWithoutComments)) !== null) {
        lastTrailerIdx = tm.index;
      }
      if (lastTrailerIdx >= 0) {
        const trailerSpan = extractDirectDictWithSpan(bodyWithoutComments, lastTrailerIdx);
        if (!trailerSpan) return false;
        if (
          !/^trailer\s*$/.test(
            bodyWithoutComments.slice(lastTrailerIdx, trailerSpan.openIdx).trim()
          )
        ) {
          return false;
        }
        const scalarTrailer = stripDirectArrays(trailerSpan.content);
        const trailerEntries = parsePdfDictEntries(scalarTrailer);
        if (!trailerEntries) return false;
        const rootEntries = trailerEntries.filter((e) => e.key === "/Root");
        if (rootEntries.length !== 1 || rootEntries[0].val.kind !== "REF") {
          return false;
        }
        candidateCatalogKeys.push(
          `${rootEntries[0].val.num}:${rootEntries[0].val.gen}`
        );
      } else {
        for (const [key, objBody] of objects.entries()) {
          const entries = parsePdfDictEntries(stripDirectArrays(objBody));
          if (
            entries &&
            entries.some(
              (e) =>
                e.key === "/Type" &&
                e.val.kind === "NAME" &&
                e.val.value === "/Catalog"
            )
          ) {
            candidateCatalogKeys.push(key);
          }
        }
      }
      if (candidateCatalogKeys.length === 0) return false;

      let hasReachablePage = false;
      for (const catalogKey of candidateCatalogKeys) {
        const objBody = objects.get(catalogKey);
        if (!objBody) continue;
        const scalarCatalog = stripDirectArrays(objBody);
        const catalogEntries = parsePdfDictEntries(scalarCatalog);
        if (!catalogEntries) continue;
        const typeEntries = catalogEntries.filter((e) => e.key === "/Type");
        if (
          typeEntries.length !== 1 ||
          typeEntries[0].val.kind !== "NAME" ||
          typeEntries[0].val.value !== "/Catalog"
        ) {
          continue;
        }
        const pagesEntries = catalogEntries.filter((e) => e.key === "/Pages");
        if (pagesEntries.length !== 1 || pagesEntries[0].val.kind !== "REF") {
          continue;
        }
        const rootPagesKey = `${pagesEntries[0].val.num}:${pagesEntries[0].val.gen}`;
        const visited = new Set<string>();
        let pageCount = 0;

        const walkPageTree = (nodeKey: string, expectedParentKey?: string): number => {
          if (visited.has(nodeKey)) return -1;
          visited.add(nodeKey);
          const nodeBody = objects.get(nodeKey);
          if (!nodeBody) return -1;
          const scalarNode = stripDirectArrays(nodeBody);
          const nodeEntries = parsePdfDictEntries(scalarNode);
          if (!nodeEntries) return -1;
          const nodeTypeEntries = nodeEntries.filter((e) => e.key === "/Type");
          if (
            nodeTypeEntries.length !== 1 ||
            nodeTypeEntries[0].val.kind !== "NAME"
          ) {
            return -1;
          }
          const nodeType = nodeTypeEntries[0].val.value;
          const parentEntries = nodeEntries.filter((e) => e.key === "/Parent");
          if (expectedParentKey !== undefined) {
            if (
              parentEntries.length !== 1 ||
              parentEntries[0].val.kind !== "REF" ||
              `${parentEntries[0].val.num}:${parentEntries[0].val.gen}` !==
                expectedParentKey
            ) {
              return -1;
            }
          } else if (parentEntries.length > 0) {
            return -1;
          }
          if (nodeType === "/Page") {
            if (
              nodeEntries.some((e) => e.key === "/Kids" || e.key === "/Count")
            ) {
              return -1;
            }
            pageCount++;
            return 1;
          }
          if (nodeType !== "/Pages") {
            return -1;
          }
          const kidsEntries = nodeEntries.filter((e) => e.key === "/Kids");
          if (
            kidsEntries.length !== 1 ||
            kidsEntries[0].val.kind !== "COMPOSITE" ||
            kidsEntries[0].val.value !== "[]"
          ) {
            return -1;
          }
          if ((nodeBody.match(/\/Kids\b/g) || []).length !== 1) return -1;
          const kidsMatch = /\/Kids\s*\[([^\]]*)\]/.exec(nodeBody);
          if (!kidsMatch || !/^\s*(?:\d+\s+\d+\s+R(?:\s+|$))+$/.test(kidsMatch[1])) {
            return -1;
          }
          const kidKeys: string[] = [];
          const refRegex = /(\d+)\s+(\d+)\s+R\b/g;
          let rm: RegExpExecArray | null;
          while ((rm = refRegex.exec(kidsMatch[1])) !== null) {
            kidKeys.push(`${Number(rm[1])}:${Number(rm[2])}`);
          }
          if (kidKeys.length === 0) return -1;
          let subtreeLeaves = 0;
          for (const kidKey of kidKeys) {
            const childLeaves = walkPageTree(kidKey, nodeKey);
            if (childLeaves <= 0) return -1;
            subtreeLeaves += childLeaves;
          }
          const countEntries = nodeEntries.filter((e) => e.key === "/Count");
          if (
            countEntries.length !== 1 ||
            countEntries[0].val.kind !== "INT" ||
            countEntries[0].val.value !== subtreeLeaves
          ) {
            return -1;
          }
          return subtreeLeaves;
        };

        if (walkPageTree(rootPagesKey) > 0 && pageCount > 0) {
          hasReachablePage = true;
          break;
        }
      }
      return hasReachablePage;
    }
    default:
      return false;
  }
}

/**
 * Converts image (.png, .jpg, .jpeg, .webp) and document (.pdf) buffers
 * into Base64 `inlineData` format for Gemini 3.5 Flash Lite Multimodal grading.
 */
export function parseMediaBuffer(
  buffer: Buffer,
  fileName: string,
  extension: string
): MediaParseResult {
  const ext = extension.toLowerCase();
  const mimeType = MIME_BY_EXTENSION[ext] || "application/octet-stream";
  const subjectType = ext === ".pdf" ? "DOCUMENT" : "IMAGE";

  if (!buffer || buffer.length === 0) {
    return {
      success: false,
      subjectType,
      extractedText: "",
      inlineDataParts: [],
      summary: { fileName, extension: ext, mimeType, byteSize: 0 },
      errorReason: `File đa phương tiện '${fileName}' rỗng (0 byte).`,
    };
  }

  if (buffer.length > MAX_INLINE_MEDIA_BYTES) {
    return {
      success: false,
      subjectType,
      extractedText: "",
      inlineDataParts: [],
      summary: { fileName, extension: ext, mimeType, byteSize: buffer.length },
      errorReason: `File '${fileName}' có dung lượng ${(buffer.length / 1024 / 1024).toFixed(1)}MB vượt quá giới hạn 20MB cho đầu vào Multimodal.`,
    };
  }

  if (!verifyMediaSignature(buffer, ext)) {
    return {
      success: false,
      subjectType,
      extractedText: "",
      inlineDataParts: [],
      summary: { fileName, extension: ext, mimeType, byteSize: buffer.length },
      errorReason: `File '${fileName}' bị hỏng hoặc không đúng chữ ký định dạng ${ext.toUpperCase()} hợp lệ.`,
    };
  }

  const base64Data = buffer.toString("base64");
  const sizeKb = (buffer.length / 1024).toFixed(1);

  return {
    success: true,
    subjectType,
    extractedText: `[MULTIMODAL_${subjectType}] Đã nạp file '${fileName}' (${mimeType}, ${sizeKb} KB) dưới dạng inlineData (Base64) gửi trực tiếp vào Gemini Multimodal.`,
    inlineDataParts: [
      {
        inlineData: {
          mimeType,
          data: base64Data,
        },
      },
    ],
    summary: {
      fileName,
      extension: ext,
      mimeType,
      byteSize: buffer.length,
    },
  };
}
