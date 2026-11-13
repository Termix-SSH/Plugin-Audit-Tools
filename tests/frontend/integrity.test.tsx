import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({
  pass: (props: { children?: unknown }) => props.children as never,
}));

vi.mock("@termix-ssh/plugin-sdk/frontend", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values ? `${key} ${JSON.stringify(values)}` : key,
  }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@termix-ssh/plugin-sdk/ui", () => ({
  Button: (props: {
    children?: unknown;
    onClick?: () => void;
    disabled?: boolean;
  }) => (
    <button onClick={props.onClick} disabled={props.disabled}>
      {props.children as never}
    </button>
  ),
  LoadingState: () => <div>loading</div>,
  NoticePanel: (props: { title: string }) => <div>{props.title}</div>,
  PANEL: { body: "" },
  PanelFrame: h.pass,
  PanelShell: (props: { actions?: unknown; children?: unknown }) => (
    <div>
      {props.actions as never}
      {props.children as never}
    </div>
  ),
  RefreshButton: () => null,
  StatusBadge: (props: { children?: unknown }) => (
    <span>{props.children as never}</span>
  ),
  TextAreaField: (props: {
    label: string;
    value: string;
    onChange: (value: string) => void;
  }) => (
    <textarea
      aria-label={props.label}
      value={props.value}
      onChange={(event) => props.onChange(event.target.value)}
    />
  ),
}));

import {
  createIntegrityTab,
  readPastedHead,
} from "../../src/frontend/IntegrityTab";

const good = {
  ok: true,
  checked: 12,
  unchained: 3,
  head: { id: 40, hash: "e".repeat(64) },
  checkedAt: "2026-11-13T00:00:00.000Z",
};

function app(post = vi.fn()) {
  return {
    api: {
      get: vi.fn(async () => ({ data: { result: good } })),
      post,
    },
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("readPastedHead", () => {
  it("reads the downloaded file or a bare id and hash", () => {
    expect(
      readPastedHead(
        JSON.stringify({ id: 4, hash: "a".repeat(64), checkedAt: "x" }),
      ),
    ).toEqual({ id: 4, hash: "a".repeat(64) });
    expect(readPastedHead("not json")).toBeNull();
    expect(readPastedHead(JSON.stringify({ id: 4, hash: "short" }))).toBeNull();
  });
});

describe("IntegrityTab", () => {
  it("shows the last check and the newest head", async () => {
    const Tab = createIntegrityTab(app());
    render(<Tab />);
    expect(await screen.findByText("integrity.ok")).toBeTruthy();
    expect(screen.getByText(/integrity.head/).textContent).toContain(
      "e".repeat(64),
    );
  });

  it("checks now and compares a pasted head", async () => {
    const post = vi.fn(async (path: string) =>
      path === "/chain/verify"
        ? {
            data: {
              result: {
                ...good,
                ok: false,
                brokenAt: 7,
                problem: "row_changed",
              },
            },
          }
        : {
            data: {
              result: { found: false, ok: false, pruned: false, chain: good },
            },
          },
    );
    const Tab = createIntegrityTab(app(post));
    render(<Tab />);
    fireEvent.click(await screen.findByText("integrity.checkNow"));
    expect(await screen.findByText(/integrity.broken/)).toBeTruthy();
    expect(screen.getByText("integrity.problem.row_changed")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("integrity.paste"), {
      target: { value: JSON.stringify({ id: 40, hash: "f".repeat(64) }) },
    });
    fireEvent.click(screen.getByText("integrity.compare"));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith("/chain/check-head", {
        id: 40,
        hash: "f".repeat(64),
      }),
    );
    expect(await screen.findByText("integrity.headMissing")).toBeTruthy();
  });
});
