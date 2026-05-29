#!/usr/bin/env node

import 'dotenv/config';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { PersonioClient } from './api/personio-client.js';
import {
  EmployeeHandlers,
  AttendanceHandlers,
  AttendanceHandlersV2,
  AbsenceHandlers,
  AnalyticsHandlers,
  UtilityHandlers,
  DocumentHandlers,
  ApprovalHandlers,
  RecruitingHandlers
} from './handlers/index.js';
import { toolDefinitions } from './tools/tool-definitions.js';

// URI of the tenant attribute-schema resource (see setupResourceHandlers).
const ATTRIBUTES_RESOURCE_URI = 'personio://employees/attributes';

// Environment variables
const CLIENT_ID = process.env.PERSONIO_CLIENT_ID;
const CLIENT_SECRET = process.env.PERSONIO_CLIENT_SECRET;

if (!CLIENT_ID || !CLIENT_SECRET) {
  throw new Error('PERSONIO_CLIENT_ID and PERSONIO_CLIENT_SECRET environment variables are required');
}

class PersonioServer {
  private server: Server;
  private personioClient: PersonioClient;
  private employeeHandlers: EmployeeHandlers;
  private attendanceHandlers: AttendanceHandlers;
  private attendanceHandlersV2: AttendanceHandlersV2;
  private absenceHandlers: AbsenceHandlers;
  private analyticsHandlers: AnalyticsHandlers;
  private utilityHandlers: UtilityHandlers;
  private documentHandlers: DocumentHandlers;
  private approvalHandlers: ApprovalHandlers;
  private recruitingHandlers: RecruitingHandlers;

  constructor() {
    this.server = new Server(
      {
        name: 'personio-mcp-server',
        version: '0.1.0',
      },
      {
        capabilities: {
          tools: {},
          resources: {},
        },
      }
    );

    this.personioClient = new PersonioClient({
      clientId: CLIENT_ID!,
      clientSecret: CLIENT_SECRET!,
    });

    // Initialize handlers
    this.employeeHandlers = new EmployeeHandlers(this.personioClient);
    this.attendanceHandlers = new AttendanceHandlers(this.personioClient);
    this.attendanceHandlersV2 = new AttendanceHandlersV2(this.personioClient);
    this.absenceHandlers = new AbsenceHandlers(this.personioClient);
    this.analyticsHandlers = new AnalyticsHandlers(this.personioClient);
    this.utilityHandlers = new UtilityHandlers(this.personioClient);
    this.documentHandlers = new DocumentHandlers(this.personioClient);
    this.approvalHandlers = new ApprovalHandlers(this.personioClient);
    this.recruitingHandlers = new RecruitingHandlers(this.personioClient);

    this.setupToolHandlers();
    this.setupResourceHandlers();

    // Error handling
    this.server.onerror = (error) => console.error('[MCP Error]', error);
    process.on('SIGINT', async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  private setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: toolDefinitions,
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request: any) => {
      try {
        switch (request.params.name) {
          // Employee Tools
          case 'get_employee':
            return await this.employeeHandlers.handleGetEmployee(request.params.arguments);
          
          case 'list_employees':
            return await this.employeeHandlers.handleListEmployees(request.params.arguments);
          
          case 'search_employees':
            return await this.employeeHandlers.handleSearchEmployees(request.params.arguments);

          case 'list_employee_attributes':
            return await this.employeeHandlers.handleListEmployeeAttributes(request.params.arguments);

          // Attendance Tools
          case 'get_attendance_records':
            return await this.attendanceHandlers.handleGetAttendanceRecords(request.params.arguments);
          
          case 'get_current_attendance_status':
            return await this.attendanceHandlers.handleGetCurrentAttendanceStatus(request.params.arguments);
          
          case 'generate_attendance_report':
            return await this.attendanceHandlers.handleGenerateAttendanceReport(request.params.arguments);
          
          // Absence Tools
          case 'get_absences':
            return await this.absenceHandlers.handleGetAbsences(request.params.arguments);
          
          case 'get_employee_absence_balance':
            return await this.absenceHandlers.handleGetEmployeeAbsenceBalance(request.params.arguments);
          
          case 'get_absence_types':
            return await this.absenceHandlers.handleGetAbsenceTypes(request.params.arguments);
          
          case 'get_team_absence_overview':
            return await this.absenceHandlers.handleGetTeamAbsenceOverview(request.params.arguments);
          
          case 'get_absence_statistics':
            return await this.absenceHandlers.handleGetAbsenceStatistics(request.params.arguments);
          
          // Analytics Tools
          case 'get_team_availability':
            return await this.analyticsHandlers.handleGetTeamAvailability(request.params.arguments);
          
          // Document Management Tools
          case 'get_document_categories':
            return await this.documentHandlers.handleGetDocumentCategories(request.params.arguments);
          
          case 'get_employee_documents':
            return await this.documentHandlers.handleGetEmployeeDocuments(request.params.arguments);
          
          case 'upload_document':
            return await this.documentHandlers.handleUploadDocument(request.params.arguments);
          
          case 'download_document':
            return await this.documentHandlers.handleDownloadDocument(request.params.arguments);
          
          case 'delete_document':
            return await this.documentHandlers.handleDeleteDocument(request.params.arguments);
          
          case 'get_documents_by_category':
            return await this.documentHandlers.handleGetDocumentsByCategory(request.params.arguments);
          
          // Approval Workflow Tools
          case 'create_attendance_with_approval':
            return await this.approvalHandlers.handleCreateAttendanceWithApproval(request.params.arguments);
          
          case 'get_pending_approvals':
            return await this.approvalHandlers.handleGetPendingApprovals(request.params.arguments);
          
          case 'get_attendance_approval_status':
            return await this.approvalHandlers.handleGetAttendanceApprovalStatus(request.params.arguments);
          
          case 'get_absence_approval_status':
            return await this.approvalHandlers.handleGetAbsenceApprovalStatus(request.params.arguments);
          
          case 'get_approval_workflow_summary':
            return await this.approvalHandlers.handleGetApprovalWorkflowSummary(request.params.arguments);
          
          // Utility Tools
          case 'api_health_check':
            return await this.utilityHandlers.handleApiHealthCheck(request.params.arguments);

          // V2 Attendance Period Tools
          case 'get_attendance_periods_v2':
            return await this.attendanceHandlersV2.handleGetAttendancePeriodsV2(request.params.arguments);

          case 'get_attendance_period_v2':
            return await this.attendanceHandlersV2.handleGetAttendancePeriodV2(request.params.arguments);

          case 'create_attendance_period_v2':
            return await this.attendanceHandlersV2.handleCreateAttendancePeriodV2(request.params.arguments);

          case 'update_attendance_period_v2':
            return await this.attendanceHandlersV2.handleUpdateAttendancePeriodV2(request.params.arguments);

          case 'delete_attendance_period_v2':
            return await this.attendanceHandlersV2.handleDeleteAttendancePeriodV2(request.params.arguments);

          case 'generate_v1_v2_compatibility_report':
            return await this.attendanceHandlersV2.handleGenerateV1V2CompatibilityReport(request.params.arguments);

          // Recruiting Tools
          case 'list_recruiting_applications':
            return await this.recruitingHandlers.handleListRecruitingApplications(request.params.arguments);

          case 'get_recruiting_application':
            return await this.recruitingHandlers.handleGetRecruitingApplication(request.params.arguments);

          case 'list_application_stage_transitions':
            return await this.recruitingHandlers.handleListApplicationStageTransitions(request.params.arguments);

          case 'list_application_documents':
            return await this.recruitingHandlers.handleListApplicationDocuments(request.params.arguments);

          case 'download_application_document':
            return await this.recruitingHandlers.handleDownloadApplicationDocument(request.params.arguments);

          case 'list_recruiting_candidates':
            return await this.recruitingHandlers.handleListRecruitingCandidates(request.params.arguments);

          case 'get_recruiting_candidate':
            return await this.recruitingHandlers.handleGetRecruitingCandidate(request.params.arguments);

          case 'list_recruiting_jobs':
            return await this.recruitingHandlers.handleListRecruitingJobs(request.params.arguments);

          case 'get_recruiting_job':
            return await this.recruitingHandlers.handleGetRecruitingJob(request.params.arguments);

          case 'list_recruiting_categories':
            return await this.recruitingHandlers.handleListRecruitingCategories(request.params.arguments);

          default:
            throw new McpError(
              ErrorCode.MethodNotFound,
              `Unknown tool: ${request.params.name}`
            );
        }
      } catch (error) {
        if (error instanceof McpError) {
          throw error;
        }
        
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${error instanceof Error ? error.message : 'Unknown error occurred'}`,
            },
          ],
          isError: true,
        };
      }
    });
  }

  private setupResourceHandlers() {
    // The tenant attribute schema is stable reference data, so it is also
    // exposed as a resource that clients can attach to context proactively —
    // complementing the list_employee_attributes tool, which the model calls on
    // demand. Both read from the same cached PersonioClient.getAttributeSchema().
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => ({
      resources: [
        {
          uri: ATTRIBUTES_RESOURCE_URI,
          name: 'Personio employee attributes',
          description:
            'Catalog of every employee attribute this Personio account exposes: ' +
            'raw key, the output name it is surfaced under, that name\'s source, ' +
            'label and value type. Tenant-global.',
          mimeType: 'application/json',
        },
      ],
    }));

    this.server.setRequestHandler(ReadResourceRequestSchema, async (request: any) => {
      const { uri } = request.params;
      if (uri !== ATTRIBUTES_RESOURCE_URI) {
        throw new McpError(ErrorCode.InvalidParams, `Unknown resource: ${uri}`);
      }

      const attributes = await this.personioClient.getAttributeSchema();
      return {
        contents: [
          {
            uri,
            mimeType: 'application/json',
            text: JSON.stringify({ attributes, count: attributes.length }, null, 2),
          },
        ],
      };
    });
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Personio MCP server running on stdio');
  }
}

const server = new PersonioServer();
server.run().catch(console.error);
