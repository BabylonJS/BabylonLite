import { describe, expect, it } from "vitest";

import type { EngineContext } from "../../../packages/babylon-lite/src/engine/engine";
import { getPickingPipelineSet } from "../../../packages/babylon-lite/src/picking/picking-pipeline";
import { pickingShaderSource, pickingThinInstanceShaderSource } from "../../../packages/babylon-lite/src/picking/picking-shader";
import type { PickDiscardRule, PickOptions } from "../../../packages/babylon-lite/src";

function makeEngine(): {
    engine: EngineContext;
    device: {
        bindGroupLayouts: GPUBindGroupLayoutDescriptor[];
        shaderModules: GPUShaderModuleDescriptor[];
        pipelineLayouts: GPUPipelineLayoutDescriptor[];
        renderPipelines: GPURenderPipelineDescriptor[];
    };
} {
    const device = {
        bindGroupLayouts: [] as GPUBindGroupLayoutDescriptor[],
        shaderModules: [] as GPUShaderModuleDescriptor[],
        pipelineLayouts: [] as GPUPipelineLayoutDescriptor[],
        renderPipelines: [] as GPURenderPipelineDescriptor[],
        createBindGroupLayout(descriptor: GPUBindGroupLayoutDescriptor): GPUBindGroupLayout {
            this.bindGroupLayouts.push(descriptor);
            return descriptor as unknown as GPUBindGroupLayout;
        },
        createShaderModule(descriptor: GPUShaderModuleDescriptor): GPUShaderModule {
            this.shaderModules.push(descriptor);
            return descriptor as unknown as GPUShaderModule;
        },
        createPipelineLayout(descriptor: GPUPipelineLayoutDescriptor): GPUPipelineLayout {
            this.pipelineLayouts.push(descriptor);
            return descriptor as unknown as GPUPipelineLayout;
        },
        createRenderPipeline(descriptor: GPURenderPipelineDescriptor): GPURenderPipeline {
            this.renderPipelines.push(descriptor);
            return descriptor as unknown as GPURenderPipeline;
        },
    };

    return {
        engine: { _device: device as unknown as GPUDevice } as unknown as EngineContext,
        device,
    };
}

describe("picking discard shader API", () => {
    it("keeps the default picker shader non-discarding", () => {
        const regular = pickingShaderSource();
        const thin = pickingThinInstanceShaderSource();

        expect(regular).toContain("struct PickDiscardInput");
        expect(regular).toContain("fn shouldDiscardPick(input: PickDiscardInput) -> bool");
        expect(regular).toContain("return false;");
        expect(regular).toContain("out.hasThinInstance = 0u;");
        expect(regular).toContain("out.thinInstanceIndex = 0xffffffffu;");

        expect(thin).toContain("fn shouldDiscardPick(input: PickDiscardInput) -> bool");
        expect(thin).toContain("return false;");
        expect(thin).toContain("out.hasThinInstance = 1u;");
        expect(thin).toContain("out.thinInstanceIndex = instanceIndex;");
        expect(thin).toContain("out.instanceExtras = vec4f(m[0].w, m[1].w, m[2].w, m[3].w);");
    });

    it("injects a custom discard rule into regular and thin-instance picking shaders", () => {
        const discardWgsl = `
fn shouldDiscardPick(input: PickDiscardInput) -> bool {
return input.hasThinInstance == 1u && input.instanceExtras.x > 4.0;
}`;

        const regular = pickingShaderSource({ discardWgsl });
        const thin = pickingThinInstanceShaderSource({ discardWgsl });

        expect(regular).toContain(discardWgsl);
        expect(thin).toContain(discardWgsl);
        expect(regular).toContain("let discardInput = PickDiscardInput(input.worldPos, input.pickId, input.thinInstanceIndex, input.hasThinInstance, input.instanceExtras);");
        expect(thin).toContain("let world = mat4x4f(");
        expect(thin).toContain("vec4f(m[0].xyz, 0.0)");
        expect(thin).toContain("vec4f(m[3].xyz, 1.0)");
    });
});

describe("picking discard pipeline API", () => {
    it("keeps the public discard rule WGSL-only", () => {
        const discard: PickDiscardRule = {
            key: "public-wgsl-only",
            wgsl: "fn shouldDiscardPick(input: PickDiscardInput) -> bool { return input.pickId == 1u; }",
        };
        const options: PickOptions = { discard };

        // @ts-expect-error PickDiscardRule intentionally does not expose raw WebGPU bind-group layout entries.
        const invalidPublicDiscardRule: PickDiscardRule = { key: "raw-webgpu", wgsl: discard.wgsl, bindGroupLayoutEntries: [] };

        expect(options.discard).toBe(discard);
        void invalidPublicDiscardRule;
    });

    it("caches the default regular/thin pipeline set per device", () => {
        const { engine, device } = makeEngine();

        const first = getPickingPipelineSet(engine);
        const second = getPickingPipelineSet(engine);

        expect(second).toBe(first);
        expect(first.discardBGL).toBeNull();
        expect(device.renderPipelines).toHaveLength(2);
        expect(device.shaderModules.map((m) => m.label)).toEqual(["picking-shader", "picking-ti-shader"]);
        expect(device.pipelineLayouts.every((layout) => Array.from(layout.bindGroupLayouts).length === 2)).toBe(true);
    });

    it("creates a discard pipeline set with a group-2 layout and injected WGSL", () => {
        const { engine, device } = makeEngine();
        const entry: GPUBindGroupLayoutEntry = {
            binding: 0,
            visibility: GPUShaderStage.FRAGMENT,
            buffer: { type: "read-only-storage" },
        };
        const discard = {
            key: "clip-volume",
            wgsl: "fn shouldDiscardPick(input: PickDiscardInput) -> bool { return input.pickId == 7u; }",
            bindGroupLayoutEntries: [entry],
        };

        const set = getPickingPipelineSet(engine, discard);

        expect(set.discardBGL).not.toBeNull();
        expect(device.bindGroupLayouts.find((layout) => layout.label === "picking-discard-clip-volume-bgl")).toMatchObject({
            label: "picking-discard-clip-volume-bgl",
            entries: [entry],
        });
        expect(device.renderPipelines).toHaveLength(2);
        expect(device.shaderModules.every((module) => String(module.code).includes(discard.wgsl))).toBe(true);
        expect(device.pipelineLayouts.every((layout) => Array.from(layout.bindGroupLayouts).length === 3)).toBe(true);
    });

    it("invalidates cached pipeline sets when the WebGPU device changes", () => {
        const first = makeEngine();
        const second = makeEngine();

        getPickingPipelineSet(first.engine);
        getPickingPipelineSet(second.engine);

        expect(first.device.renderPipelines).toHaveLength(2);
        expect(second.device.renderPipelines).toHaveLength(2);
    });
});
