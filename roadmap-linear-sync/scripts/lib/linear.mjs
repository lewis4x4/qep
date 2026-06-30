// scripts/lib/linear.mjs
// Minimal Linear GraphQL client. No SDK dependency.
// Uses Node 20+ native fetch.

const LINEAR_API_URL = 'https://api.linear.app/graphql';

export class LinearError extends Error {
  constructor(message, { status, errors } = {}) {
    super(message);
    this.name = 'LinearError';
    this.status = status;
    this.errors = errors;
  }
}

export class LinearClient {
  constructor(apiKey) {
    if (!apiKey) throw new Error('LINEAR_API_KEY required');
    this.apiKey = apiKey;
  }

  async gql(query, variables = {}) {
    const res = await fetch(LINEAR_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: this.apiKey,
      },
      body: JSON.stringify({ query, variables }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new LinearError(`Linear HTTP ${res.status}: ${text}`, { status: res.status });
    }
    const json = await res.json();
    if (json.errors) {
      throw new LinearError(`Linear GraphQL errors: ${JSON.stringify(json.errors)}`, { errors: json.errors });
    }
    return json.data;
  }

  // ---- Teams / Workflow ----------------------------------------------------

  async getTeamByKey(key) {
    const data = await this.gql(`
      query($key: String!) {
        teams(filter: { key: { eq: $key } }) {
          nodes { id key name }
        }
      }
    `, { key });
    return data.teams.nodes[0] || null;
  }

  async getWorkflowStates(teamId) {
    const data = await this.gql(`
      query($teamId: ID!) {
        workflowStates(filter: { team: { id: { eq: $teamId } } }, first: 100) {
          nodes { id name type position }
        }
      }
    `, { teamId });
    return data.workflowStates.nodes;
  }

  // ---- Projects ------------------------------------------------------------

  async listProjects(teamId) {
    const data = await this.gql(`
      query($teamId: ID!) {
        projects(filter: { accessibleTeams: { id: { eq: $teamId } } }, first: 100) {
          nodes { id name slugId state }
        }
      }
    `, { teamId });
    return data.projects.nodes;
  }

  async createProject({ teamId, name, description }) {
    const data = await this.gql(`
      mutation($input: ProjectCreateInput!) {
        projectCreate(input: $input) {
          success
          project { id name slugId }
        }
      }
    `, { input: { name, teamIds: [teamId], description: description ?? '' } });
    if (!data.projectCreate.success) throw new LinearError(`projectCreate failed: ${name}`);
    return data.projectCreate.project;
  }

  // ---- Labels --------------------------------------------------------------

  async listLabels(teamId) {
    const data = await this.gql(`
      query($teamId: ID!) {
        issueLabels(filter: { team: { id: { eq: $teamId } } }, first: 250) {
          nodes { id name color }
        }
      }
    `, { teamId });
    return data.issueLabels.nodes;
  }

  async createLabel({ teamId, name, color = '#94a3b8' }) {
    const data = await this.gql(`
      mutation($input: IssueLabelCreateInput!) {
        issueLabelCreate(input: $input) {
          success
          issueLabel { id name color }
        }
      }
    `, { input: { name, color, teamId } });
    if (!data.issueLabelCreate.success) throw new LinearError(`issueLabelCreate failed: ${name}`);
    return data.issueLabelCreate.issueLabel;
  }

  // ---- Issues --------------------------------------------------------------

  async findIssueByTaskId(teamId, taskId) {
    // Searches description for the canonical "task_id: X.xx" line written by the importer.
    const data = await this.gql(`
      query($teamId: ID!, $term: String!) {
        issues(
          filter: { team: { id: { eq: $teamId } }, description: { contains: $term } }
          first: 5
        ) {
          nodes { id identifier url description state { id name type } }
        }
      }
    `, { teamId, term: `task_id: ${taskId}` });
    // Confirm exact match
    return data.issues.nodes.find(n =>
      (n.description ?? '').includes(`task_id: ${taskId}\n`) ||
      (n.description ?? '').endsWith(`task_id: ${taskId}`)
    ) ?? null;
  }

  async createIssue(input) {
    const data = await this.gql(`
      mutation($input: IssueCreateInput!) {
        issueCreate(input: $input) {
          success
          issue { id identifier url state { id name type } }
        }
      }
    `, { input });
    if (!data.issueCreate.success) throw new LinearError(`issueCreate failed`);
    return data.issueCreate.issue;
  }

  async updateIssue(id, input) {
    const data = await this.gql(`
      mutation($id: String!, $input: IssueUpdateInput!) {
        issueUpdate(id: $id, input: $input) {
          success
          issue { id identifier url state { id name type } }
        }
      }
    `, { id, input });
    if (!data.issueUpdate.success) throw new LinearError(`issueUpdate failed: ${id}`);
    return data.issueUpdate.issue;
  }

  async createComment({ issueId, body }) {
    const data = await this.gql(`
      mutation($input: CommentCreateInput!) {
        commentCreate(input: $input) {
          success
          comment { id }
        }
      }
    `, { input: { issueId, body } });
    if (!data.commentCreate.success) throw new LinearError(`commentCreate failed: issue ${issueId}`);
    return data.commentCreate.comment;
  }
}
