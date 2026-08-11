export type McpGuideClientId = 'codex' | 'claude-code';

export type McpGuideCommand = {
  id: string;
  label: string;
  command: string;
  description: string;
};

export type McpGuideClient = {
  id: McpGuideClientId;
  label: string;
  description: string;
  documentationUrl: string;
  commands: McpGuideCommand[];
  notes: string[];
};

export type McpGuideStep = {
  title: string;
  description: string;
};

export type McpTroubleshootingItem = {
  id: string;
  title: string;
  description: string;
  command?: string;
};

const SAGEUM_MCP_PATH = '/api/mcp';

export const MCP_TEST_PROMPT = 'Sageum에서 환경 변수 명세와 관련된 근거를 찾아줘';

export const MCP_OAUTH_STEPS: McpGuideStep[] = [
  {
    title: '클라이언트에 Sageum 등록',
    description: '아래 명령어를 터미널에서 실행해 HTTPS MCP Endpoint를 등록합니다.',
  },
  {
    title: 'OAuth 로그인 시작',
    description: '로그인 명령을 실행하면 브라우저에서 Sageum 로그인 화면이 열립니다.',
  },
  {
    title: '문서 접근 승인',
    description: '접근 범위를 확인하고 승인하면 현재 Sageum 계정의 문서만 연결됩니다.',
  },
  {
    title: '연결 목록에서 확인',
    description: '이 가이드에서 연결 목록으로 돌아가 승인된 클라이언트가 표시되는지 확인합니다.',
  },
];

export const MCP_TROUBLESHOOTING: McpTroubleshootingItem[] = [
  {
    id: 'duplicate-name',
    title: '같은 이름의 MCP 설정이 이미 있습니다',
    description: '기존 sageum 설정을 제거한 뒤 등록 명령을 다시 실행하세요.',
  },
  {
    id: 'oauth-expired',
    title: 'OAuth가 만료되었거나 로그인이 실패합니다',
    description: '선택한 클라이언트의 로그인 명령을 다시 실행해 인증을 갱신하세요.',
  },
  {
    id: 'callback-failed',
    title: '브라우저 callback이 실패하거나 headless 환경입니다',
    description: 'Claude Code는 --no-browser 로그인을 사용하고, 안내된 URL과 redirect URL을 터미널에 입력하세요. Codex는 브라우저를 사용할 수 있는 환경에서 다시 로그인하세요.',
  },
  {
    id: 'connection-missing',
    title: 'Sageum 연결 목록에 나타나지 않습니다',
    description: '브라우저의 Sageum 로그인과 접근 승인 화면을 마지막 단계까지 완료했는지 확인하세요.',
  },
  {
    id: 'upload-denied',
    title: '문서 업로드 권한이 거부됩니다',
    description: '연결 목록으로 돌아가 해당 클라이언트의 업로드 허용을 켜세요. 기본 연결은 읽기 전용입니다.',
  },
  {
    id: 'localhost-external',
    title: '외부 클라이언트에서 localhost Endpoint가 연결되지 않습니다',
    description: 'localhost 대신 Sageum의 HTTPS 배포 Endpoint를 등록하세요.',
  },
];

export function buildSageumMcpEndpoint(siteUrl: string) {
  const url = new URL(siteUrl);
  const normalizedPath = url.pathname.replace(/\/+$/u, '');

  if (normalizedPath === SAGEUM_MCP_PATH) {
    url.pathname = SAGEUM_MCP_PATH;
    url.search = '';
    url.hash = '';
    return url.toString();
  }

  return new URL(SAGEUM_MCP_PATH, url.origin).toString();
}

export function buildMcpGuideClients(mcpEndpoint: string): McpGuideClient[] {
  return [
    {
      id: 'codex',
      label: 'Codex',
      description: 'Codex CLI에 Streamable HTTP MCP 서버를 등록하고 OAuth로 연결합니다.',
      documentationUrl: 'https://learn.chatgpt.com/docs/extend/mcp?surface=cli',
      commands: [
        {
          id: 'codex-add',
          label: '1. Sageum 등록',
          command: `codex mcp add sageum --url ${mcpEndpoint}`,
          description: '같은 Codex 호스트의 데스크톱 앱·CLI·IDE 확장에서 설정을 공유합니다.',
        },
        {
          id: 'codex-login',
          label: '2. OAuth 로그인',
          command: 'codex mcp login sageum',
          description: '브라우저에서 Sageum에 로그인하고 문서 접근을 승인합니다.',
        },
        {
          id: 'codex-list',
          label: '3. 연결 검증',
          command: 'codex mcp list',
          description: '등록된 서버 목록에서 sageum 연결 상태를 확인합니다.',
        },
      ],
      notes: [
        'Codex 안에서는 /mcp를 입력해 현재 연결 상태와 사용 가능한 도구를 확인할 수 있습니다.',
        '재인증은 codex mcp login sageum, 제거는 codex mcp remove sageum을 사용합니다.',
      ],
    },
    {
      id: 'claude-code',
      label: 'Claude Code',
      description: 'Claude Code에 원격 HTTP MCP 서버를 user scope로 등록하고 OAuth로 연결합니다.',
      documentationUrl: 'https://code.claude.com/docs/en/mcp',
      commands: [
        {
          id: 'claude-add',
          label: '1. Sageum 등록',
          command: `claude mcp add --transport http --scope user sageum ${mcpEndpoint}`,
          description: '모든 프로젝트에서 사용할 수 있도록 사용자 설정에 등록합니다.',
        },
        {
          id: 'claude-login',
          label: '2. OAuth 로그인',
          command: 'claude mcp login sageum',
          description: '브라우저에서 Sageum에 로그인하고 문서 접근을 승인합니다.',
        },
        {
          id: 'claude-list',
          label: '3. 연결 목록 확인',
          command: 'claude mcp list',
          description: 'sageum 서버가 Connected 상태인지 확인합니다.',
        },
        {
          id: 'claude-get',
          label: '4. 연결 상세 확인',
          command: 'claude mcp get sageum',
          description: '등록 URL과 연결 문제의 상세 정보를 확인합니다.',
        },
      ],
      notes: [
        '특정 프로젝트에서만 사용하려면 등록 명령의 --scope user를 --scope local로 바꿀 수 있습니다.',
        '브라우저를 열 수 없으면 claude mcp login sageum --no-browser를 사용합니다.',
        '제거는 claude mcp remove sageum을 사용합니다.',
      ],
    },
  ];
}
