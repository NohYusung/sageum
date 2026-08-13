import 'server-only';

import { createRequire } from 'node:module';

const requireFromServer = createRequire(import.meta.url);

export const dagre = requireFromServer('@dagrejs/dagre') as typeof import('@dagrejs/dagre');
