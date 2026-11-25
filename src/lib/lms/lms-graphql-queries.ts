/**
 * Shared MindX LMS GraphQL Queries for pure-Node HTTP read operations (Phase 1)
 * and future Chrome Extension / write operations (Phase 3+).
 */

export const LMS_GET_CLASSES_QUERY = `
  query LmsGetClasses($payload: ClassQuery) {
    classes(payload: $payload) {
      data {
        id
        name
        status
        startDate
        endDate
        course {
          id
          name
          shortName
        }
        centre {
          id
          name
          shortName
        }
        teachers {
          role {
            name
          }
          teacher {
            id
            fullName
            username
          }
        }
      }
      pagination {
        total
      }
    }
  }
`;

export const LMS_GET_CLASSES_MINIMAL_QUERY = `
  query LmsGetClassesMinimal($payload: ClassQuery) {
    classes(payload: $payload) {
      data {
        id
        name
        status
        startDate
        endDate
      }
      pagination {
        total
      }
    }
  }
`;

export const LMS_MISS_ATTEND_CLASSES_QUERY = `
  query classesMissAttendOrComment($type: [String], $search: String, $centres: [String], $pageIndex: Int, $itemsPerPage: Int, $orderBy: String, $status: [String]) {
    classesMissAttendOrComment(
      payload: {
        type: $type,
        filter_textSearch: $search,
        centre_in: $centres,
        pageIndex: $pageIndex,
        itemsPerPage: $itemsPerPage,
        orderBy: $orderBy,
        status_in: $status
      }
    ) {
      data {
        id
        name
        status
        startDate
        endDate
        course {
          id
          name
        }
        centre {
          id
          name
          shortName
        }
        teachers {
          role {
            name
          }
          teacher {
            fullName
            username
          }
        }
      }
    }
  }
`;

export const LMS_MISS_ATTEND_MINIMAL_QUERY = `
  query classesMissAttendOrCommentMinimal($type: [String], $search: String, $centres: [String], $pageIndex: Int, $itemsPerPage: Int, $orderBy: String, $status: [String]) {
    classesMissAttendOrComment(
      payload: {
        type: $type,
        filter_textSearch: $search,
        centre_in: $centres,
        pageIndex: $pageIndex,
        itemsPerPage: $itemsPerPage,
        orderBy: $orderBy,
        status_in: $status
      }
    ) {
      data {
        id
        name
      }
    }
  }
`;

export const LMS_GET_CLASS_BY_ID_QUERY = `
  query GetClassById($id: ID!) {
    classesById(id: $id) {
      id
      name
      status
      startDate
      endDate
      numberOfSessions
      course {
        id
        name
        shortName
      }
      centre {
        id
        name
        shortName
        code
      }
      teachers {
        role {
          name
        }
        teacher {
          id
          fullName
          username
        }
      }
      students {
        activeInClass
        student {
          id
          fullName
        }
      }
      slots {
        _id
        index
        date
        startTime
        endTime
        summary
        homework
        teachers {
          isActive
          role {
            name
            shortName
          }
          teacher {
            id
            fullName
            username
          }
        }
        teacherAttendance {
          status
          teacher {
            id
            fullName
            username
          }
        }
        studentAttendance {
          _id
          status
          comment
          sendCommentStatus
          commentByAreas {
            type
            grade
            content
            commentAreaId
            courseProcessDemoId
            courseProcessFinalEvaluationId
            courseProcessFinalEvaluationTitle
            courseProcessCheckpointEvaluationId
            courseProcessCheckpointEvaluationTitle
            checkpoint {
              checkpointScore
              practiceScore
              checkpointQuestions {
                id
                title
                result
                score
              }
            }
            demoQuestions {
              courseProcessDemoDetailId
              title
              result
              score
              maxScore
            }
          }
          student {
            id
            fullName
          }
        }
      }
    }
  }
`;

export const LMS_GET_CLASS_BY_ID_SAFE_QUERY = `
  query GetClassByIdSafe($id: ID!) {
    classesById(id: $id) {
      id
      name
      status
      startDate
      endDate
      course {
        id
        name
      }
      teachers {
        role {
          name
        }
        teacher {
          fullName
          username
        }
      }
      students {
        activeInClass
        student {
          id
          fullName
        }
      }
      slots {
        _id
        index
        summary
        homework
        date
        startTime
        endTime
        teachers {
          isActive
          role {
            name
            shortName
          }
          teacher {
            id
            fullName
            username
          }
        }
        teacherAttendance {
          status
          teacher {
            id
            fullName
            username
          }
        }
        studentAttendance {
          _id
          status
          comment
          sendCommentStatus
          commentByAreas {
            type
            grade
            content
            commentAreaId
            courseProcessDemoId
            checkpoint {
              checkpointScore
              practiceScore
              checkpointQuestions {
                result
              }
            }
            demoQuestions {
              courseProcessDemoDetailId
              title
              result
              score
              maxScore
            }
          }
          student {
            id
            fullName
          }
        }
      }
    }
  }
`;

export const LMS_GET_CLASS_BY_ID_MINIMAL_QUERY = `
  query GetClassByIdMinimal($id: ID!) {
    classesById(id: $id) {
      id
      name
      status
      startDate
      endDate
      course {
        id
        name
      }
      teachers {
        role {
          name
        }
        teacher {
          fullName
          username
        }
      }
      students {
        activeInClass
        student {
          id
          fullName
        }
      }
      slots {
        _id
        summary
        homework
        date
        startTime
        endTime
        studentAttendance {
          status
          comment
          sendCommentStatus
          student {
            id
            fullName
          }
        }
      }
    }
  }
`;

export const LMS_CLASS_FIELD_BY_ID_QUERY = `
  query AdminGetClassFieldById($id: ID!) {
    class(id: $id) {
      id
      name
      status
      startDate
      endDate
      course {
        id
        name
      }
      teachers {
        role {
          name
        }
        teacher {
          fullName
          username
        }
      }
      students {
        activeInClass
        student {
          id
          fullName
        }
      }
      slots {
        _id
        index
        summary
        homework
        date
        startTime
        endTime
        teachers {
          isActive
          role {
            name
            shortName
          }
          teacher {
            id
            fullName
            username
          }
        }
        teacherAttendance {
          status
          teacher {
            id
            fullName
            username
          }
        }
        studentAttendance {
          _id
          status
          comment
          sendCommentStatus
          commentByAreas {
            type
            grade
            content
            commentAreaId
            courseProcessDemoId
            checkpoint {
              checkpointScore
              practiceScore
              checkpointQuestions {
                result
              }
            }
            demoQuestions {
              courseProcessDemoDetailId
              title
              result
              score
              maxScore
            }
          }
          student {
            id
            fullName
          }
        }
      }
    }
  }
`;

export const LMS_CLASS_FIELD_BY_ID_MINIMAL_QUERY = `
  query AdminGetClassFieldByIdMinimal($id: ID!) {
    class(id: $id) {
      id
      name
      status
      startDate
      endDate
      course {
        id
        name
      }
      teachers {
        role {
          name
        }
        teacher {
          fullName
          username
        }
      }
      students {
        activeInClass
        student {
          id
          fullName
        }
      }
      slots {
        _id
        summary
        homework
        date
        startTime
        endTime
        studentAttendance {
          status
          comment
          sendCommentStatus
          student {
            id
            fullName
          }
        }
      }
    }
  }
`;

export const LMS_FIND_STUDENT_SUBMISSION_BY_CLASS_QUERY = `
  query FindStudentSubmissionByClass($payload: FindStudentSubmissionByClassQuery) {
    findStudentSubmissionByClass(payload: $payload) {
      lessons {
        id
        name
        type
        isActive
        displayOrder
      }
      students {
        id
        studentUid
        displayName
        lessonIds
      }
      submissions {
        id
        type
        note
        score
        status
        category
        classId
        lessonId
        studentUid
        submittedAt
        submittedCount
        content {
          attachments
          type
          practiceFormat
        }
      }
    }
  }
`;

export const LMS_FIND_STUDENT_SUBMISSION_BY_CLASS_LEGACY_QUERY = `
  query FindStudentSubmissionByClassLegacy($classId: ID!) {
    findStudentSubmissionByClass(classId: $classId) {
      lessons {
        id
        name
        type
        displayOrder
      }
      students {
        id
        studentUid
        displayName
      }
      submissions {
        id
        lessonId
        studentId
        studentUid
        category
        status
        score
        submittedCount
        submittedAt
        content {
          attachments
        }
      }
    }
  }
`;

export const LMS_FIND_ALL_STUDENT_WORKS_QUERY = `
  query AdminFindWorks($classId: String) {
    findAllStudentWorks(payload: { classId_equals: $classId }) {
      data {
        id
        status
        studentId
        classSessionId
        classSessionNumber
        classId
        isDeleted
        latestData {
          title
          comment
          thumbnail
          imageUrl
          attachmentUrls
          videoUrls
        }
      }
    }
  }
`;

export const LMS_FIND_ALL_STUDENT_WORKS_MINIMAL_QUERY = `
  query AdminFindWorksMinimal($classId: String) {
    findAllStudentWorks(payload: { classId_equals: $classId }) {
      data {
        id
        status
        studentId
        classSessionId
        classSessionNumber
        classId
        isDeleted
        latestData {
          title
          comment
        }
      }
    }
  }
`;

export const LMS_TEACHER_BY_USER_ID_QUERY = `
  query teacherByUserId($user: String) {
    teacherByUserId(payload: { user: $user }) {
      id
      email
      mainCentre {
        id
        name
      }
    }
  }
`;

export const LMS_FIND_STUDENT_LETTERS_BY_CLASS_QUERY = `
  query FindStudentLettersByClass($classId: String!) {
    findStudentLettersPagination(
      payload: { classId_equals: $classId, pageIndex: 0, itemsPerPage: 100 }
    ) {
      data {
        id
        studentId
        status
        content
        approvedContent
        macros {
          key
          value
        }
      }
    }
  }
`;

export const LMS_FIND_ALL_STUDENT_WORKS_FULL_QUERY = `
  query FindAllStudentWorks($classId: String) {
    findAllStudentWorks(payload: { classId_equals: $classId }) {
      data {
        id
        status
        studentId
        classSessionId
        classSessionNumber
        classId
        version
        displayOrder
        isDeleted
        latestData {
          title
          thumbnail
          videoUrls
          imageUrl
          attachmentUrls
          comment
          rejectReason
          relatedUrls {
            name
            url
          }
        }
      }
    }
  }
`;

export const LMS_CREATE_STUDENT_WORK_MUTATION = `
  mutation CreateStudentWork($payload: CreateStudentWorkCommand!) {
    studentWorks {
      create(payload: $payload) {
        id
        status
        studentId
        classSessionId
        classId
        version
        displayOrder
        latestData {
          title
          thumbnail
          videoUrls
          imageUrl
          attachmentUrls
          comment
          rejectReason
          relatedUrls {
            name
            url
          }
        }
      }
    }
  }
`;

export const LMS_UPDATE_STUDENT_WORK_MUTATION = `
  mutation UpdateStudentWork($payload: UpdateStudentWorkCommand!) {
    studentWorks {
      update(payload: $payload) {
        id
        status
        studentId
        classSessionId
        classId
        version
        displayOrder
        latestData {
          title
          thumbnail
          videoUrls
          imageUrl
          attachmentUrls
          comment
          rejectReason
          relatedUrls {
            name
            url
          }
        }
      }
    }
  }
`;

export const LMS_DELETE_STUDENT_WORK_MUTATION = `
  mutation DeleteStudentWork($payload: DeleteStudentWorkCommand!) {
    studentWorks {
      del(payload: $payload) {
        id
      }
    }
  }
`;

export const LMS_GET_CLASS_WRITE_CONTEXT_QUERY = `
  query GetClassWriteContext($id: ID!) {
    classesById(id: $id) {
      id
      name
      status
      course {
        id
        name
        shortName
      }
      centre {
        id
      }
      courseProcesses {
        id
        name
        finalSession {
          demoScore {
            id
            commentAreas {
              id
              name
              demoDetails {
                id
                title
                score
              }
            }
          }
          finalEvaluations {
            id
            title
            commentAreas {
              id
              name
              type
            }
          }
        }
      }
      students {
        activeInClass
        student {
          id
          fullName
        }
      }
      slots {
        _id
        index
        summary
        homework
        studentAttendance {
          _id
          status
          comment
          student {
            id
            fullName
          }
          commentByAreas {
            type
            grade
            content
            commentAreaId
            courseProcessDemoId
            courseProcessFinalEvaluationId
            courseProcessFinalEvaluationTitle
            demoQuestions {
              courseProcessDemoDetailId
              title
              result
              score
              maxScore
            }
          }
        }
      }
    }
  }
`;

export const LMS_UPDATE_SLOT_COMMENT_MUTATION = `
  mutation UpdateSlotComment($payload: UpdateSlotCommentCommand!) {
    classes {
      updateSlotComment(payload: $payload) {
        id
        slots {
          _id
          summary
          homework
          studentAttendance {
            _id
            comment
            student {
              id
              fullName
            }
            commentByAreas {
              commentAreaId
              type
              grade
              content
              courseProcessDemoId
              demoQuestions {
                courseProcessDemoDetailId
                title
                score
                maxScore
              }
            }
          }
        }
      }
    }
  }
`;

export const LMS_FIND_ONE_STUDENT_LETTER_QUERY = `
  query FindOneByCriteria($payload: FindOneByConditionPayload) {
    findOneByCriteria(payload: $payload) {
      id
      studentId
      classId
      status
      content
      approvedContent
      emailTemplateId
      sourceContent
      macros {
        key
        value
      }
    }
  }
`;

export const LMS_EMAIL_TEMPLATES_QUERY = `
  query GetEmailTemplates($payload: EmailTemplateQuery) {
    emailTemplates(payload: $payload) {
      data {
        id
        systemCode
        name
        content
        isActive
      }
    }
  }
`;

export const LMS_CREATE_STUDENT_LETTERS_MUTATION = `
  mutation CreateStudentLetters($payload: CreateStudentLettersCommand!) {
    studentLetters {
      create(payload: $payload) {
        id
        studentId
        classId
        status
        content
        macros {
          key
          value
        }
      }
    }
  }
`;

export const LMS_UPDATE_STUDENT_LETTERS_MUTATION = `
  mutation UpdateStudentLetters($payload: UpdateStudentLettersCommand!) {
    studentLetters {
      update(payload: $payload) {
        id
        studentId
        classId
        status
        content
        macros {
          key
          value
        }
      }
    }
  }
`;
