import pathlib,json,datetime,hashlib
out=pathlib.Path(__file__).resolve().parent
gates=[json.loads(s) for s in (out/'gates.jsonl').read_text(encoding='utf8').splitlines()]
probes=[json.loads(s) for s in (out/'probes.jsonl').read_text(encoding='utf8').splitlines()]
observations={name:len(json.loads((out/name).read_text(encoding='utf8'))) for name in ('reset-observations.json','observations.json','matrix-observations.json','repository-observations.json')}
assert len(gates)==17 and all(g['exit']==0 for g in gates),gates
assert len(probes)==4 and all(g['exit']==0 for g in probes),probes
assert sum(observations.values())==36,observations
summary={'recorded_at':datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=7))).isoformat(),'verdict':'GO','head':'a78c5a1b1b67735f6e9987d06c437513e771ae06','scope':'HEAD plus uncommitted working tree, exact source-before.json snapshot','gate_count':len(gates),'gates_passed':len(gates),'workspace_tsc_exit':0,'independent_probes':probes,'observations':observations,'total_observations':sum(observations.values()),'mirror':(out/'mirror-path.txt').read_text(encoding='utf8'),'source_integrity':json.loads((out/'source-integrity.json').read_text(encoding='utf8'))['summary'],'real_data_files_read_or_hashed_or_copied':False,'live_services_used':False,'application_sources_or_product_tests_changed_by_review':False}
(out/'execution-summary.json').write_text(json.dumps(summary,indent=2),encoding='utf8')
print(json.dumps(summary,ensure_ascii=True))
