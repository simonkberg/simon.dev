import {
  AppRouterContext,
  type AppRouterInstance,
} from "next/dist/shared/lib/app-router-context.shared-runtime";
import { RouterContext } from "next/dist/shared/lib/router-context.shared-runtime";
import type { NextRouter } from "next/router";
import { type PropsWithChildren, use, useEffect, useReducer } from "react";
import { vi } from "vitest";

const Loading = ({ page }: { page: Promise<void> }) => {
  use(page);
  return null;
};

/**
 * An app router for Link and `useRouter`, whose navigations stay pending,
 * as a real one's do, until `arrive()` lets their pages in.
 */
export function mockRouter() {
  const pending: (() => void)[] = [];
  let load: (page: Promise<void>) => void = () => {};
  const navigate = vi.fn<AppRouterInstance["replace"]>(() =>
    load(new Promise((resolve) => pending.push(resolve))),
  );
  const router: AppRouterInstance = {
    bfcacheId: "",
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
    push: navigate,
    replace: navigate,
  };
  // Outside Next's bundler, next/link is the Pages Router's, which reads its own context.
  const pages = {
    prefetch: () => Promise.resolve(),
    push: navigate,
    replace: navigate,
  } as unknown as NextRouter;

  const Router = ({ children }: PropsWithChildren) => {
    const [page, navigateTo] = useReducer(
      (_: Promise<void> | undefined, next: Promise<void>) => next,
      undefined,
    );
    useEffect(() => {
      load = navigateTo;
    }, []);
    return (
      <AppRouterContext value={router}>
        <RouterContext value={pages}>
          {page && <Loading page={page} />}
          {children}
        </RouterContext>
      </AppRouterContext>
    );
  };

  const arrive = () => {
    for (const resolve of pending.splice(0)) resolve();
  };

  return { navigate, Router, arrive };
}
