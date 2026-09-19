// 이 레포는 @types/node를 의존성으로 두지 않는다 (브라우저 번들이라 필요 없다).
// boundary.test.ts가 node:fs / node:path로 소스 트리를 읽어 import 경계를 검사하는데
// 쓰는 최소한의 타입만 여기 선언한다. 실제 타입은 vitest가 node 환경에서 제공한다.

declare module 'node:fs' {
  export interface Dirent {
    name: string
    isDirectory(): boolean
  }
  export function readdirSync(path: string, options: { withFileTypes: true }): Dirent[]
  export function readFileSync(path: string, encoding: 'utf-8'): string
}

declare module 'node:path' {
  export function join(...parts: string[]): string
  export function resolve(...parts: string[]): string
}

declare const __dirname: string
