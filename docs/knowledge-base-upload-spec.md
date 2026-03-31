# Knowledge Base Upload Spec

## Purpose

Define the source-of-truth behavior for knowledge-base document uploads and document re-indexing across the admin UI and the `ingest` Supabase Edge Function.

This spec covers:

- Browser drag-and-drop upload
- Browser file-picker upload
- OneDrive document sync ingestion
- Re-indexing existing documents

This spec does not cover:

- OCR for scanned/image-only documents
- Multi-file upload in a single action
- Legacy `.doc` files
- Spreadsheet parsing beyond raw CSV text

## Supported File Types

The knowledge base accepts these extensions for browser upload:

- `.pdf`
- `.docx`
- `.txt`
- `.md`
- `.csv`

The backend treats uploads as one of three ingest classes:

- `pdf`
- `docx`
- `text`

`.txt`, `.md`, and `.csv` are all ingested as plain text.

## Admin UI Contract

The administration knowledge-base panel must:

- Show the exact supported extensions listed above
- Accept one file at a time
- Reject unsupported extensions before network upload
- Reject files larger than 50 MB before network upload
- Allow upload by click or drag-and-drop
- Show upload progress while the request is in flight
- Reset the file input after each selection
- Show destructive toast errors for client-side validation failures
- Show destructive toast errors for server-side failures

When more than one file is dropped, the UI must reject the action and instruct the user to upload one document at a time.

## Authorization Contract

Upload, re-index, and OneDrive sync requests require an authenticated user with one of these roles:

- `admin`
- `manager`
- `owner`

Users outside those roles must receive a forbidden response.

## Browser Upload Request Contract

The browser sends `multipart/form-data` to the `ingest` edge function with:

- `file`: uploaded file blob
- `title`: file name without extension

The edge function is the final authority for validation even if the browser already screened the file.

## Backend Validation Contract

The `ingest` function must:

- Reject requests with no file
- Reject files larger than 50 MB with HTTP `413`
- Reject unsupported types with HTTP `415`
- Normalize empty browser MIME types from the filename extension when possible
- Verify PDF content using `%PDF` magic bytes
- Verify DOCX content using ZIP container magic bytes
- Reject mismatched declared type vs actual file content with HTTP `415`
- Reject files with no extractable text with HTTP `422`

## Extraction Contract

### PDF

- Parser: `pdf-parse`
- Requirement: the PDF must contain extractable text
- Rejection case: scanned/image-only or password-protected PDFs return a `422`-class failure

### DOCX

- Parser: `mammoth`
- Requirement: the document must be a standard `.docx` file with extractable text
- Rejection case: malformed, empty, or image-only DOCX files return a `422`-class failure

### TXT / MD / CSV

- Extraction method: raw text read from the uploaded file
- Requirement: resulting text must not be empty after trimming

## Document Persistence Contract

After successful extraction, the backend must create or update a document row with:

- `title`
- `source`
- `source_id`
- `mime_type`
- `raw_text`
- `word_count`
- `uploaded_by`
- `is_active = false` before embedding completes

Source mapping rules:

- Browser PDF upload uses `source = "pdf_upload"`
- Browser DOCX/TXT/MD/CSV upload uses `source = "manual"`
- OneDrive sync uses `source = "onedrive"`

## Chunking And Embedding Contract

After raw text is stored, the system must:

- Split text into overlapping chunks
- Delete any existing chunks for the document before re-ingest
- Generate embeddings for each chunk
- Insert chunk rows into `chunks`
- Mark the document active after chunk insert succeeds

If chunk insertion or embedding generation fails, the upload is not considered complete.

## Re-index Contract

Re-indexing uses JSON POSTs to the same `ingest` function with:

- `document_id`

The backend must:

- Load the stored `raw_text`
- Reject documents with no stored raw text
- Rebuild chunk rows from persisted content
- Mark the document active after successful re-index

Re-indexing does not re-download or re-parse the original file.

## OneDrive Sync Contract

OneDrive delta sync must support the same logical file families as browser upload:

- PDF
- DOCX
- TXT / MD / CSV-equivalent text files when MIME or extension can be inferred

For each supported OneDrive file:

- Download the file contents
- Extract text according to file type
- Skip files that fail parsing or contain no extractable text
- Upsert the corresponding `documents` row by `source_id`
- Rebuild chunks from the latest extracted text

## User-Facing Error Expectations

The user should receive a clear message for these cases:

- Unsupported file type
- File too large
- File content does not match its extension/type
- Document has no extractable text
- Authentication missing
- Role does not permit document management
- Re-index failed

Messages should explain the concrete reason and, where relevant, the corrective action.

## Current Non-Goals

These behaviors are intentionally out of scope until explicitly implemented:

- OCR for scanned PDFs
- `.doc` support
- Bulk upload queues
- Folder drag-and-drop
- Automatic metadata extraction beyond title, MIME type, and word count
- Structured CSV row parsing into records

## Regression Checklist

Before considering this flow stable, verify:

1. `.pdf` uploads succeed for text-based PDFs
2. `.docx` uploads succeed for standard Word documents
3. `.txt`, `.md`, and `.csv` uploads succeed
4. Unsupported extensions are blocked in the UI
5. Unsupported content is rejected by the backend even if renamed
6. Files over 50 MB are blocked
7. Multi-file drag-and-drop is rejected with a clear message
8. Re-index succeeds for an existing document with stored raw text
9. OneDrive sync processes supported file types without regressing PDF ingestion
