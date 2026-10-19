import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen } from "@testing-library/react";
import {
  renderWithApp,
  type RenderedPluginApp,
} from "@termix-ssh/plugin-sdk/testing";
import type { PluginManifest } from "@termix-ssh/plugin-sdk/manifest";
import * as plugin from "../../src/frontend/index";
import { exportQuery } from "../../src/frontend/index";
import manifestJson from "../../manifest.json";
import locales from "../../locales/en.json";

const manifest = manifestJson as unknown as PluginManifest;

let rendered: RenderedPluginApp | null = null;

afterEach(async () => {
  await rendered?.deactivate();
  rendered = null;
});

describe("exportQuery", () => {
  it("adds the format and leaves empty filters out", () => {
    expect(
      exportQuery("csv", { action: "login", userId: "", success: false }),
    ).toBe("format=csv&action=login&success=false");
  });
});

describe(`${manifest.id} activate`, () => {
  it("contributes the export buttons to the audit toolbar", async () => {
    const get = vi.fn(async () => ({
      data: new Blob(["x"]),
      headers: { "content-disposition": 'attachment; filename="a.csv"' },
    }));
    rendered = await renderWithApp(plugin, {
      manifest,
      locales,
      api: { get } as never,
    });

    expect(rendered.registered.slot("audit.toolbar")).toEqual([
      "audit-tools.export",
    ]);
  });

  it("asks the export route with the viewer filters", async () => {
    const get = vi.fn(async () => ({
      data: new Blob(["x"]),
      headers: {},
    }));
    URL.createObjectURL = vi.fn(() => "blob:test");
    URL.revokeObjectURL = vi.fn();
    rendered = await renderWithApp(plugin, {
      manifest,
      locales,
      api: { get } as never,
    });
    rendered.renderSlot("audit.toolbar", { filters: { action: "login" } });
    await act(async () => {
      fireEvent.click(screen.getByText(locales.export.csv));
    });

    expect(get).toHaveBeenCalledWith("/export?format=csv&action=login", {
      responseType: "blob",
    });
  });
});
