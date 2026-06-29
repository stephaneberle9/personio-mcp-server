/**
 * Strict live verification for the recruiting document tools.
 *
 * Unlike the smoke test (which tolerates 403 as "pass"), this FAILS on any
 * isError/403 and proves the full path end-to-end: it lists recruiting
 * applications, finds one that actually HAS a document, and DOWNLOADS that
 * document — exercising the Recruiting API (personio:recruiting:read), the
 * Document Management list endpoint AND its download endpoint (documents:read)
 * in one run.
 *
 * Credentials are resolved by ./test-credentials.mjs (env vars, a repo-root .env
 * or .env.<name>, or ~/.secrets/personio/.env.<name>); the chosen source is
 * printed. Pass the name as the first arg: `node test-application-documents.mjs
 * recruiting` (defaults to "recruiting").
 *
 * Usage: npm run build && node test-application-documents.mjs [name]
 * Exit codes: 0 = works (downloaded a document), 1 = failed (403/isError/bad
 * shape/no creds), 2 = inconclusive (no application has a document to download).
 */

import { PersonioClient } from './build/api/personio-client.js';
import { RecruitingHandlers } from './build/handlers/index.js';
import { loadPersonioCredentials } from './test-credentials.mjs';

const name = process.argv[2];

function parseResult(result) {
  return JSON.parse(result.content[0].text);
}

function fail(message, result) {
  console.error(`FAIL: ${message}`);
  if (result) console.error('  ' + result.content[0].text.replace(/\n/g, '\n  '));
  process.exit(1);
}

console.log('\nPersonio MCP Server — Application Documents Test');
console.log(`Date: ${new Date().toISOString().split('T')[0]}\n`);

const { clientId, clientSecret } = loadPersonioCredentials(name);

const client = new PersonioClient({ clientId, clientSecret });
const recruitingH = new RecruitingHandlers(client);

// 1) List applications (exercises Recruiting access).
const appsResult = await recruitingH.handleListRecruitingApplications({ limit: 25 });
if (appsResult.isError) fail('could not list recruiting applications (recruiting access?)', appsResult);

const applications = parseResult(appsResult).applications || [];
if (applications.length === 0) {
  console.warn('INCONCLUSIVE: no recruiting applications in this tenant to test against.');
  process.exit(2);
}

// 2) Find an application that actually has a document (exercises the Document
//    Management LIST endpoint). A 403 here is the access gap we test for.
let target = null;
for (const app of applications) {
  const applicationId = String(app.id);
  const docsResult = await recruitingH.handleListApplicationDocuments({ application_id: applicationId });
  if (docsResult.isError) fail(`list_application_documents failed for application ${applicationId} (Documents access?)`, docsResult);

  const documents = parseResult(docsResult).documents || [];
  if (documents.length > 0) {
    target = { applicationId, document: documents[0] };
    break;
  }
}

if (!target) {
  console.warn(`INCONCLUSIVE: scanned ${applications.length} application(s); none had a document to download.`);
  process.exit(2);
}

// 3) Download the document (exercises the Document Management DOWNLOAD endpoint).
const documentId = String(target.document.id);
console.log(`Downloading document ${documentId} ("${target.document.name ?? 'unnamed'}") from application ${target.applicationId} ...`);

const dlResult = await recruitingH.handleDownloadApplicationDocument({ document_id: documentId });
if (dlResult.isError) fail('download_application_document returned an error', dlResult);

const dl = parseResult(dlResult);
if (!dl.content || !(dl.size > 0)) {
  fail(`download returned no content (size=${dl.size})`, dlResult);
}

console.log(`PASS: downloaded "${target.document.name ?? 'unnamed'}" — ${dl.size} bytes (${dl.content_type}).`);
process.exit(0);
