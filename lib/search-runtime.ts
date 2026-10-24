import { AsyncLocalStorage } from 'node:async_hooks';

type SearchEnvironment = { KEENABLE_API_KEY?: string };
const searchEnvironment = new AsyncLocalStorage<SearchEnvironment>();
export function runWithSearchEnvironment<T>(env: SearchEnvironment, callback: () => T): T {
  return searchEnvironment.run({ KEENABLE_API_KEY: env.KEENABLE_API_KEY }, callback);
}
export function getSearchKey(): string {
  return searchEnvironment.getStore()?.KEENABLE_API_KEY || '';
}
