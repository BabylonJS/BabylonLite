/// <reference types="vite/client" />

declare module "*.wgsl?raw" {
    const content: string;
    export default content;
}

declare module "*?worker&inline" {
    const Worker: { new (options?: { name?: string }): Worker };
    export default Worker;
}
