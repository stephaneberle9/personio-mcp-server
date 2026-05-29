// Tool definitions for Personio MCP server

export const toolDefinitions = [
  // Employee Tools
  {
    name: 'get_employee',
    description: 'Get detailed information about a specific employee by ID',
    inputSchema: {
      type: 'object',
      properties: {
        employee_id: {
          type: 'number',
          description: 'Employee ID',
        },
        attributes: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Optional: limit the response to these attributes. Accepts either raw ' +
            'Personio keys (e.g. "first_name", "dynamic_10913352") or resolved ' +
            'output names (e.g. "name", "kostenstelle_kurz"); names are translated ' +
            'to raw keys automatically. Passing this limits the response to exactly ' +
            'these fields, so include every field you need. Call ' +
            'list_employee_attributes to discover available attributes.',
        },
      },
      required: ['employee_id'],
    },
  },
  {
    name: 'list_employees',
    description: 'Get a list of all employees with optional filtering and export formats. Supports filtering by office/location and exporting to JSON or CSV formats.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Maximum number of employees to return (default: 200)',
          minimum: 1,
          maximum: 200,
        },
        offset: {
          type: 'number',
          description: 'Number of employees to skip for pagination',
          minimum: 0,
        },
        attributes: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Optional: limit the response to these attributes. Accepts either raw ' +
            'Personio keys (e.g. "first_name", "dynamic_10913352") or resolved ' +
            'output names (e.g. "name", "kostenstelle_kurz"); names are translated ' +
            'to raw keys automatically. Passing this limits the response to exactly ' +
            'these fields, so include every field you need. Call ' +
            'list_employee_attributes to discover available attributes.',
        },
        office: {
          type: 'string',
          description: 'Optional: filter employees by office/workplace name (case-insensitive partial match)',
        },
        format: {
          type: 'string',
          enum: ['json', 'csv'],
          description: 'Output format: "json" (default) or "csv" for spreadsheet export',
        },
      },
    },
  },
  {
    name: 'search_employees',
    description: 'Search for employees by name, email, or department',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query (name, email, or department)',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of matching results to return (default: 50). The query is always evaluated against the full employee set; this only caps the page size.',
          minimum: 1,
          maximum: 200,
        },
        offset: {
          type: 'number',
          description: 'Number of matching results to skip for pagination',
          minimum: 0,
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'list_employee_attributes',
    description:
      'Discover which employee attributes this Personio account exposes. Returns, ' +
      'for each attribute, its raw `key`, the `output_key` it is surfaced under, ' +
      'the `source` of that name (map | label | key), its `label` and value `type`. ' +
      'Use this to learn which field names to pass to the `attributes` parameter of ' +
      'get_employee / list_employees (either key works) and how custom `dynamic_<id>` ' +
      'fields are named.',
    inputSchema: {
      type: 'object',
      properties: {
        employee_id: {
          type: 'number',
          description:
            'Optional: sample the schema from this employee. Labels are the same ' +
            'tenant-wide, so any employee works; omit to use the first listed one.',
        },
      },
    },
  },

  // Attendance Tools
  {
    name: 'get_attendance_records',
    description: 'Retrieve attendance records with optional date and employee filters',
    inputSchema: {
      type: 'object',
      properties: {
        start_date: {
          type: 'string',
          description: 'Start date in YYYY-MM-DD format',
        },
        end_date: {
          type: 'string',
          description: 'End date in YYYY-MM-DD format',
        },
        employee_ids: {
          type: 'array',
          items: { type: 'number' },
          description: 'Optional: specific employee IDs to filter',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of records (default: 200)',
          minimum: 1,
          maximum: 200,
        },
        offset: {
          type: 'number',
          description: 'Number of records to skip for pagination',
          minimum: 0,
        },
      },
    },
  },
  {
    name: 'get_current_attendance_status',
    description: 'Get current attendance status for today',
    inputSchema: {
      type: 'object',
      properties: {
        employee_ids: {
          type: 'array',
          items: { type: 'number' },
          description: 'Optional: specific employee IDs to check',
        },
      },
    },
  },

  // Absence Tools
  {
    name: 'get_absences',
    description: 'Retrieve absence/time-off records with optional filters',
    inputSchema: {
      type: 'object',
      properties: {
        start_date: {
          type: 'string',
          description: 'Start date in YYYY-MM-DD format',
        },
        end_date: {
          type: 'string',
          description: 'End date in YYYY-MM-DD format',
        },
        employee_ids: {
          type: 'array',
          items: { type: 'number' },
          description: 'Optional: specific employee IDs to filter',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of records (default: 200)',
          minimum: 1,
          maximum: 200,
        },
        offset: {
          type: 'number',
          description: 'Number of records to skip for pagination',
          minimum: 0,
        },
      },
    },
  },
  {
    name: 'get_employee_absence_balance',
    description: 'Get absence balance for a specific employee',
    inputSchema: {
      type: 'object',
      properties: {
        employee_id: {
          type: 'number',
          description: 'Employee ID',
        },
      },
      required: ['employee_id'],
    },
  },
  {
    name: 'get_absence_types',
    description: 'Get all available absence/time-off types',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'get_team_absence_overview',
    description: 'Get overview of who is out today or in a specific date range',
    inputSchema: {
      type: 'object',
      properties: {
        start_date: {
          type: 'string',
          description: 'Start date in YYYY-MM-DD format (default: today)',
        },
        end_date: {
          type: 'string',
          description: 'End date in YYYY-MM-DD format (default: today)',
        },
      },
    },
  },

  // Analytics Tools
  {
    name: 'generate_attendance_report',
    description: 'Generate attendance analytics report for a date range',
    inputSchema: {
      type: 'object',
      properties: {
        start_date: {
          type: 'string',
          description: 'Start date in YYYY-MM-DD format',
        },
        end_date: {
          type: 'string',
          description: 'End date in YYYY-MM-DD format',
        },
        employee_ids: {
          type: 'array',
          items: { type: 'number' },
          description: 'Optional: specific employee IDs to include',
        },
        department: {
          type: 'string',
          description: 'Optional: filter by department',
        },
      },
      required: ['start_date', 'end_date'],
    },
  },
  {
    name: 'get_team_availability',
    description: 'Get current team availability and status',
    inputSchema: {
      type: 'object',
      properties: {
        department: {
          type: 'string',
          description: 'Optional: filter by department',
        },
      },
    },
  },
  {
    name: 'get_absence_statistics',
    description: 'Get absence usage statistics and trends',
    inputSchema: {
      type: 'object',
      properties: {
        start_date: {
          type: 'string',
          description: 'Start date in YYYY-MM-DD format',
        },
        end_date: {
          type: 'string',
          description: 'End date in YYYY-MM-DD format',
        },
        department: {
          type: 'string',
          description: 'Optional: filter by department',
        },
      },
      required: ['start_date', 'end_date'],
    },
  },

  // Document Management Tools
  {
    name: 'get_document_categories',
    description: 'Get all available document categories in the company',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'get_employee_documents',
    description: 'Get documents for a specific employee (V2 Document Management API)',
    inputSchema: {
      type: 'object',
      properties: {
        employee_id: {
          type: 'number',
          description: 'Employee ID',
        },
        category_id: {
          type: 'string',
          description: 'Optional: filter by document category ID',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of documents to return (default: 50, max: 200)',
          minimum: 1,
          maximum: 200,
        },
        cursor: {
          type: 'string',
          description: 'Pagination cursor from previous response',
        },
      },
      required: ['employee_id'],
    },
  },
  {
    name: 'upload_document',
    description: 'Upload a document for an employee',
    inputSchema: {
      type: 'object',
      properties: {
        employee_id: {
          type: 'number',
          description: 'Employee ID',
        },
        category_id: {
          type: 'number',
          description: 'Document category ID',
        },
        title: {
          type: 'string',
          description: 'Document title',
        },
        file_content: {
          type: 'string',
          description: 'Base64 encoded file content',
        },
        file_name: {
          type: 'string',
          description: 'File name with extension',
        },
      },
      required: ['employee_id', 'category_id', 'title', 'file_content'],
    },
  },
  {
    name: 'download_document',
    description: 'Download a document by ID (V2 Document Management API)',
    inputSchema: {
      type: 'object',
      properties: {
        document_id: {
          type: 'string',
          description: 'Document ID (UUID string from V2 API)',
        },
      },
      required: ['document_id'],
    },
  },
  {
    name: 'delete_document',
    description: 'Delete a document by ID (V2 Document Management API)',
    inputSchema: {
      type: 'object',
      properties: {
        document_id: {
          type: 'string',
          description: 'Document ID (UUID string from V2 API)',
        },
      },
      required: ['document_id'],
    },
  },
  {
    name: 'get_documents_by_category',
    description: 'Get all documents in a specific category across all employees',
    inputSchema: {
      type: 'object',
      properties: {
        category_id: {
          type: 'number',
          description: 'Document category ID',
        },
        employee_limit: {
          type: 'number',
          description: 'Maximum number of employees to check (default: 100)',
          minimum: 1,
          maximum: 200,
        },
      },
      required: ['category_id'],
    },
  },

  // Approval Workflow Tools
  {
    name: 'create_attendance_with_approval',
    description: 'Create an attendance record with approval workflow',
    inputSchema: {
      type: 'object',
      properties: {
        employee_id: {
          type: 'number',
          description: 'Employee ID',
        },
        date: {
          type: 'string',
          description: 'Date in YYYY-MM-DD format',
        },
        start_time: {
          type: 'string',
          description: 'Start time in HH:MM format',
        },
        end_time: {
          type: 'string',
          description: 'End time in HH:MM format',
        },
        break_minutes: {
          type: 'number',
          description: 'Break time in minutes',
          minimum: 0,
        },
        comment: {
          type: 'string',
          description: 'Optional comment',
        },
        skip_approval: {
          type: 'boolean',
          description: 'Whether to skip the approval process (default: false)',
        },
      },
      required: ['employee_id', 'date', 'start_time', 'end_time'],
    },
  },
  {
    name: 'get_pending_approvals',
    description: 'Get pending approval requests',
    inputSchema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['attendance', 'absence', 'document'],
          description: 'Type of approval to filter by',
        },
        employee_id: {
          type: 'number',
          description: 'Optional: filter by employee ID',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results (default: 50)',
          minimum: 1,
          maximum: 200,
        },
        offset: {
          type: 'number',
          description: 'Number of results to skip for pagination',
          minimum: 0,
        },
      },
    },
  },
  {
    name: 'get_attendance_approval_status',
    description: 'Get attendance records with their approval status',
    inputSchema: {
      type: 'object',
      properties: {
        employee_id: {
          type: 'number',
          description: 'Optional: filter by employee ID',
        },
        start_date: {
          type: 'string',
          description: 'Start date in YYYY-MM-DD format',
        },
        end_date: {
          type: 'string',
          description: 'End date in YYYY-MM-DD format',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of records (default: 100)',
          minimum: 1,
          maximum: 200,
        },
        offset: {
          type: 'number',
          description: 'Number of records to skip for pagination',
          minimum: 0,
        },
      },
    },
  },
  {
    name: 'get_absence_approval_status',
    description: 'Get absence requests with their approval status',
    inputSchema: {
      type: 'object',
      properties: {
        employee_id: {
          type: 'number',
          description: 'Optional: filter by employee ID',
        },
        start_date: {
          type: 'string',
          description: 'Start date in YYYY-MM-DD format',
        },
        end_date: {
          type: 'string',
          description: 'End date in YYYY-MM-DD format',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of records (default: 100)',
          minimum: 1,
          maximum: 200,
        },
        offset: {
          type: 'number',
          description: 'Number of records to skip for pagination',
          minimum: 0,
        },
      },
    },
  },
  {
    name: 'get_approval_workflow_summary',
    description: 'Get a summary of all approval workflows and their status',
    inputSchema: {
      type: 'object',
      properties: {
        start_date: {
          type: 'string',
          description: 'Start date in YYYY-MM-DD format (default: today)',
        },
        end_date: {
          type: 'string',
          description: 'End date in YYYY-MM-DD format (default: today)',
        },
      },
    },
  },

  // Utility Tools
  {
    name: 'api_health_check',
    description: 'Check Personio API connectivity and authentication status',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },

  // ====== V2 Attendance Period Tools ======
  {
    name: 'get_attendance_periods_v2',
    description: 'List attendance periods using Personio v2 API with enhanced features and timezone support',
    inputSchema: {
      type: 'object',
      properties: {
        person_id: {
          type: 'number',
          description: 'Filter by specific person/employee ID',
        },
        start_date_time: {
          type: 'string',
          description: 'Start datetime in ISO 8601 format (e.g., 2024-01-01T09:00:00)',
        },
        end_date_time: {
          type: 'string',
          description: 'End datetime in ISO 8601 format (e.g., 2024-01-01T17:00:00)',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of records (default: 200)',
          minimum: 1,
          maximum: 200,
        },
        offset: {
          type: 'number',
          description: 'Number of records to skip for pagination',
          minimum: 0,
        },
      },
    },
  },
  {
    name: 'get_attendance_period_v2',
    description: 'Get a specific attendance period by ID using Personio v2 API',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'Attendance period ID (UUID)',
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'create_attendance_period_v2',
    description: 'Create a new attendance period using Personio v2 API with enhanced features',
    inputSchema: {
      type: 'object',
      properties: {
        person_id: {
          type: 'number',
          description: 'Person/employee ID',
        },
        type: {
          type: 'string',
          enum: ['WORK', 'BREAK'],
          description: 'Type of attendance period (default: WORK)',
        },
        start_date_time: {
          type: 'string',
          description: 'Start datetime in ISO 8601 format without timezone (e.g., 2024-01-01T09:00:00)',
        },
        end_date_time: {
          type: 'string',
          description: 'End datetime in ISO 8601 format without timezone (e.g., 2024-01-01T17:00:00)',
        },
        comment: {
          type: 'string',
          description: 'Optional comment',
        },
      },
      required: ['person_id', 'start_date_time'],
    },
  },
  {
    name: 'update_attendance_period_v2',
    description: 'Update an existing attendance period using Personio v2 API',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'Attendance period ID (UUID)',
        },
        person_id: {
          type: 'number',
          description: 'Person/employee ID',
        },
        type: {
          type: 'string',
          enum: ['WORK', 'BREAK'],
          description: 'Type of attendance period',
        },
        start_date_time: {
          type: 'string',
          description: 'Start datetime in ISO 8601 format without timezone',
        },
        end_date_time: {
          type: 'string',
          description: 'End datetime in ISO 8601 format without timezone',
        },
        comment: {
          type: 'string',
          description: 'Comment (can be empty string to clear)',
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'delete_attendance_period_v2',
    description: 'Delete an attendance period using Personio v2 API',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'Attendance period ID (UUID)',
        },
      },
      required: ['id'],
    },
  },
  // ====== V2 Recruiting Tools ======
  {
    name: 'list_recruiting_applications',
    description: 'List all recruiting applications with optional filtering by date range or email. Uses cursor-based pagination (V2 Recruiting API, Beta).',
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Maximum number of applications to return (1-200, default 100)',
          minimum: 1,
          maximum: 200,
        },
        cursor: {
          type: 'string',
          description: 'Cursor for pagination (from next_cursor in previous response)',
        },
        updated_at_after: {
          type: 'string',
          description: 'Filter: return applications updated after this datetime (format: YYYY-MM-DDTHH:mm:ss without timezone, e.g. 2024-01-01T00:00:00). Cannot be combined with updated_at_before.',
        },
        updated_at_before: {
          type: 'string',
          description: 'Filter: return applications updated before this datetime (format: YYYY-MM-DDTHH:mm:ss without timezone, e.g. 2024-12-31T23:59:59). Cannot be combined with updated_at_after.',
        },
        candidate_email: {
          type: 'string',
          description: 'Filter: return applications for candidate with this email address',
        },
      },
    },
  },
  {
    name: 'get_recruiting_application',
    description: 'Get detailed information about a specific recruiting application by ID (V2 Recruiting API, Beta)',
    inputSchema: {
      type: 'object',
      properties: {
        application_id: {
          type: 'string',
          description: 'Application ID',
        },
      },
      required: ['application_id'],
    },
  },
  {
    name: 'list_application_stage_transitions',
    description: 'List the stage transition history for a specific recruiting application (V2 Recruiting API, Beta)',
    inputSchema: {
      type: 'object',
      properties: {
        application_id: {
          type: 'string',
          description: 'Application ID',
        },
      },
      required: ['application_id'],
    },
  },
  {
    name: 'list_application_documents',
    description: 'List all documents (CV, cover letter, etc.) attached to a recruiting application. Uses the application_id as owner to query the Document Management API.',
    inputSchema: {
      type: 'object',
      properties: {
        application_id: {
          type: 'string',
          description: 'Application ID (the owner of the documents)',
        },
        category_id: {
          type: 'string',
          description: 'Optional: filter by document category ID',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of documents to return (1-200, default 100)',
          minimum: 1,
          maximum: 200,
        },
        cursor: {
          type: 'string',
          description: 'Cursor for pagination',
        },
      },
      required: ['application_id'],
    },
  },
  {
    name: 'download_application_document',
    description: 'Download a recruiting application document (CV, cover letter, etc.) by document ID. Returns base64-encoded file content.',
    inputSchema: {
      type: 'object',
      properties: {
        document_id: {
          type: 'string',
          description: 'Document ID (from list_application_documents)',
        },
      },
      required: ['document_id'],
    },
  },
  {
    name: 'list_recruiting_candidates',
    description: 'List all recruiting candidates with cursor-based pagination (V2 Recruiting API, Beta)',
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Maximum number of candidates to return',
          minimum: 1,
        },
        cursor: {
          type: 'string',
          description: 'Cursor for pagination (from next_cursor in previous response)',
        },
      },
    },
  },
  {
    name: 'get_recruiting_candidate',
    description: 'Get detailed information about a specific recruiting candidate by ID (V2 Recruiting API, Beta)',
    inputSchema: {
      type: 'object',
      properties: {
        candidate_id: {
          type: 'string',
          description: 'Candidate ID',
        },
      },
      required: ['candidate_id'],
    },
  },
  {
    name: 'list_recruiting_jobs',
    description: 'List all recruiting job postings with cursor-based pagination (V2 Recruiting API, Beta)',
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Maximum number of jobs to return',
          minimum: 1,
        },
        cursor: {
          type: 'string',
          description: 'Cursor for pagination (from next_cursor in previous response)',
        },
      },
    },
  },
  {
    name: 'get_recruiting_job',
    description: 'Get detailed information about a specific recruiting job posting by ID (V2 Recruiting API, Beta)',
    inputSchema: {
      type: 'object',
      properties: {
        job_id: {
          type: 'string',
          description: 'Job ID',
        },
      },
      required: ['job_id'],
    },
  },
  {
    name: 'list_recruiting_categories',
    description: 'List all recruiting job categories (V2 Recruiting API, Beta)',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },

  {
    name: 'generate_v1_v2_compatibility_report',
    description: 'Generate a compatibility report comparing v1 and v2 attendance APIs to help with migration planning',
    inputSchema: {
      type: 'object',
      properties: {
        person_id: {
          type: 'number',
          description: 'Optional: specific person/employee ID to analyze',
        },
        start_date: {
          type: 'string',
          description: 'Start date in YYYY-MM-DD format for comparison',
        },
        end_date: {
          type: 'string',
          description: 'End date in YYYY-MM-DD format for comparison',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of records to compare (default: 50)',
          minimum: 1,
          maximum: 200,
        },
      },
    },
  },
];
