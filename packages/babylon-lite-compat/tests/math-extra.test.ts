import { describe, expect, it } from "vitest";

import { Vector3 } from "../src/math/vector";
import { Matrix } from "../src/math/matrix";
import { Plane } from "../src/math/plane";
import { Ray } from "../src/math/ray";
import { Frustum } from "../src/math/frustum";
import { Size, Viewport } from "../src/math/size";
import { Angle, Curve3, Path3D } from "../src/math/curve";

describe("Plane", () => {
    it("builds from position and normal and measures signed distance", () => {
        const plane = Plane.FromPositionAndNormal(new Vector3(0, 0, 0), new Vector3(0, 1, 0));
        expect(plane.signedDistanceTo(new Vector3(0, 5, 0))).toBeCloseTo(5, 6);
        expect(plane.signedDistanceTo(new Vector3(0, -2, 0))).toBeCloseTo(-2, 6);
    });

    it("normalizes its normal", () => {
        const plane = new Plane(0, 4, 0, 8).normalize();
        expect(plane.normal.length()).toBeCloseTo(1, 6);
        expect(plane.d).toBeCloseTo(2, 6);
    });
});

describe("Ray", () => {
    it("intersects a plane in front of it", () => {
        const ray = new Ray(new Vector3(0, 5, 0), new Vector3(0, -1, 0));
        const plane = Plane.FromPositionAndNormal(new Vector3(0, 0, 0), new Vector3(0, 1, 0));
        expect(ray.intersectsPlane(plane)).toBeCloseTo(5, 6);
    });

    it("returns null for a plane behind it", () => {
        const ray = new Ray(new Vector3(0, 5, 0), new Vector3(0, 1, 0));
        const plane = Plane.FromPositionAndNormal(new Vector3(0, 0, 0), new Vector3(0, 1, 0));
        expect(ray.intersectsPlane(plane)).toBeNull();
    });

    it("detects sphere intersection", () => {
        const ray = new Ray(new Vector3(0, 0, 0), new Vector3(0, 0, 1));
        expect(ray.intersectsSphere(new Vector3(0, 0, 10), 1)).toBe(true);
        expect(ray.intersectsSphere(new Vector3(5, 0, 10), 1)).toBe(false);
    });
});

describe("Frustum", () => {
    it("extracts six normalized planes from a matrix", () => {
        const planes = Frustum.GetPlanes(Matrix.Identity());
        expect(planes).toHaveLength(6);
        for (const plane of planes) {
            expect(plane.normal.length()).toBeCloseTo(1, 5);
        }
    });
});

describe("Size / Viewport", () => {
    it("computes surface and resolves a viewport to pixels", () => {
        expect(new Size(4, 3).surface).toBe(12);
        const px = new Viewport(0, 0, 0.5, 1).toGlobal(800, 600);
        expect(px.width).toBe(400);
        expect(px.height).toBe(600);
    });
});

describe("Curve / Path", () => {
    it("samples a quadratic bezier through its endpoints", () => {
        const curve = Curve3.CreateQuadraticBezier(new Vector3(0, 0, 0), new Vector3(1, 1, 0), new Vector3(2, 0, 0), 10);
        const pts = curve.getPoints();
        expect(pts[0]!.asArray()).toEqual([0, 0, 0]);
        expect(pts[pts.length - 1]!.x).toBeCloseTo(2, 6);
        expect(curve.length()).toBeGreaterThan(2);
    });

    it("computes cumulative distances along a Path3D", () => {
        const path = new Path3D([new Vector3(0, 0, 0), new Vector3(0, 0, 3), new Vector3(0, 0, 7)]);
        expect(path.length()).toBeCloseTo(7, 6);
        expect(path.getDistances()).toEqual([0, 3, 7]);
    });

    it("converts angles", () => {
        expect(Angle.FromDegrees(180).radians()).toBeCloseTo(Math.PI, 6);
        expect(Angle.FromRadians(Math.PI).degrees()).toBeCloseTo(180, 6);
    });

    it("continues a curve by sticking the next curve onto its end", () => {
        const a = new Curve3([new Vector3(0, 0, 0), new Vector3(1, 0, 0)]);
        const b = new Curve3([new Vector3(5, 0, 0), new Vector3(5, 2, 0)]);
        const pts = a.continue(b).getPoints();
        expect(pts.map((p) => p.asArray())).toEqual([
            [0, 0, 0],
            [1, 0, 0],
            [1, 2, 0],
        ]);
    });

    it("samples cubic bezier, hermite and catmull-rom splines", () => {
        const cubic = Curve3.CreateCubicBezier(new Vector3(0, 0, 0), new Vector3(0, 1, 0), new Vector3(1, 1, 0), new Vector3(1, 0, 0), 12).getPoints();
        expect(cubic[0]!.asArray()).toEqual([0, 0, 0]);
        expect(cubic[cubic.length - 1]!.x).toBeCloseTo(1, 6);

        const hermite = Curve3.CreateHermiteSpline(new Vector3(0, 0, 0), new Vector3(1, 0, 0), new Vector3(1, 1, 0), new Vector3(0, 1, 0), 8).getPoints();
        expect(hermite.length).toBe(9);
        expect(hermite[0]!.asArray()).toEqual([0, 0, 0]);
        expect(hermite[8]!.asArray()).toEqual([1, 1, 0]);

        const closed = Curve3.CreateCatmullRomSpline([new Vector3(0, 0, 0), new Vector3(1, 1, 0), new Vector3(2, 0, 0), new Vector3(1, -1, 0)], 4, true).getPoints();
        expect(closed.length).toBe(17);
        expect(closed[0]!.asArray()).toEqual(closed[closed.length - 1]!.asArray());
    });

    it("builds an arc through three points and returns an empty curve for colinear points", () => {
        const arc = Curve3.ArcThru3Points(new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(-1, 0, 0), 16);
        expect(arc.getPoints().length).toBeGreaterThan(2);
        const first = arc.getPoints()[0]!;
        expect(first.x).toBeCloseTo(1, 3);
        expect(first.y).toBeCloseTo(0, 3);
        const colinear = Curve3.ArcThru3Points(new Vector3(0, 0, 0), new Vector3(1, 0, 0), new Vector3(2, 0, 0));
        expect(colinear.getPoints().length).toBe(0);
    });

    it("computes an orthonormal Frenet frame along a Path3D", () => {
        const path = new Path3D([new Vector3(0, 0, 0), new Vector3(0, 0, 1), new Vector3(0, 1, 1)]);
        const t = path.getTangents()[1]!;
        const n = path.getNormals()[1]!;
        const b = path.getBinormals()[1]!;
        expect(t.length()).toBeCloseTo(1, 6);
        expect(n.length()).toBeCloseTo(1, 6);
        expect(b.length()).toBeCloseTo(1, 6);
        expect(Vector3.Dot(t, n)).toBeCloseTo(0, 6);
        expect(Vector3.Dot(t, b)).toBeCloseTo(0, 6);
        expect(Vector3.Dot(n, b)).toBeCloseTo(0, 6);
    });

    it("interpolates points, indices and tangents along a Path3D", () => {
        const straight = new Path3D([new Vector3(0, 0, 0), new Vector3(2, 0, 0), new Vector3(4, 0, 0)]);
        expect(straight.length()).toBeCloseTo(4, 6);
        expect(straight.getPointAt(0.5).asArray()).toEqual([2, 0, 0]);
        expect(straight.getDistanceAt(0.25)).toBeCloseTo(1, 6);
        expect(straight.getPreviousPointIndexAt(0.75)).toBe(1);
        expect(straight.getSubPositionAt(0.25)).toBeCloseTo(0.5, 6);
        expect(straight.getClosestPositionTo(new Vector3(3, 1, 0))).toBeCloseTo(0.75, 6);
        const interpTangent = straight.getTangentAt(0.5, true);
        expect(interpTangent.x).toBeCloseTo(1, 6);
        expect(interpTangent.y).toBeCloseTo(0, 6);
        expect(interpTangent.z).toBeCloseTo(0, 6);
    });

    it("slices a sub-path and recomputes on update", () => {
        const straight = new Path3D([new Vector3(0, 0, 0), new Vector3(2, 0, 0), new Vector3(4, 0, 0)]);
        const sliced = straight.slice(0.25, 0.75).getPoints();
        expect(sliced.map((p) => p.asArray())).toEqual([
            [1, 0, 0],
            [2, 0, 0],
            [3, 0, 0],
        ]);

        const path = new Path3D([new Vector3(0, 0, 0), new Vector3(0, 0, 3), new Vector3(0, 0, 7)]);
        path.update([new Vector3(0, 0, 0), new Vector3(0, 0, 1), new Vector3(0, 0, 2)]);
        expect(path.length()).toBeCloseTo(2, 6);
        expect(path.getDistances()).toEqual([0, 1, 2]);
    });
});
