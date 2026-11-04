import type { Config, Context } from '@netlify/functions';
import handler from '../../api/markets.js';
import { invoke } from '../../lib/netlify-handler.mts';

export default async function (request: Request, context: Context) {
  return invoke(handler, request, context);
}

export const config: Config = { path: ["/api/markets"] };
