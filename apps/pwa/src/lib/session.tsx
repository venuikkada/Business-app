import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { ApiError, get, onSignedOut, post, setTenantId, getTenantId } from "./api";

export interface Business {
  id: number;
  name: string;
  sector: string;
  subscriptionStatus: string;
  role: { key: string; name: string };
}
export interface Me {
  user: { id: number; name: string; mobile: string | null; email: string | null; language: string; hasPassword: boolean };
  currentTenantId: number | null;
  businesses: Business[];
}
export interface Current {
  tenant: any;
  modules: string[];
  branches: any[];
  me: { userId: number; membershipId: number; role: { id: number; key: string; name: string }; permissions: string[]; branchIds: number[] | null };
}

interface SessionValue {
  status: "loading" | "signedOut" | "ready";
  me: Me | null;
  current: Current | null;
  reload: () => Promise<void>;
  reloadCurrent: () => Promise<void>;
  openBusiness: (id: number) => Promise<void>;
  signOut: () => Promise<void>;
  can: (perm: string) => boolean;
}

const Ctx = createContext<SessionValue>(null!);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SessionValue["status"]>("loading");
  const [me, setMe] = useState<Me | null>(null);
  const [current, setCurrent] = useState<Current | null>(null);

  const reloadCurrent = useCallback(async () => {
    try {
      setCurrent(await get<Current>("/tenant"));
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) {
        setTenantId(null);
        setCurrent(null);
      } else throw e;
    }
  }, []);

  const reload = useCallback(async () => {
    try {
      const m = await get<Me>("/me");
      setMe(m);
      // Which business this tab shows: the tab's choice, else the session's, else the only one.
      const stored = Number(getTenantId());
      const pick =
        m.businesses.find((b) => b.id === stored)?.id ??
        m.businesses.find((b) => b.id === m.currentTenantId)?.id ??
        (m.businesses.length === 1 ? m.businesses[0]!.id : null);
      setTenantId(pick);
      if (pick) await reloadCurrent();
      else setCurrent(null);
      setStatus("ready");
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        setMe(null);
        setCurrent(null);
        setStatus("signedOut");
      } else {
        setStatus((s) => (s === "loading" ? "signedOut" : s));
        throw e;
      }
    }
  }, [reloadCurrent]);

  useEffect(() => {
    reload().catch(() => {});
    return onSignedOut(() => {
      setMe(null);
      setCurrent(null);
      setStatus("signedOut");
    });
  }, [reload]);

  const openBusiness = useCallback(async (id: number) => {
    const c = await post<Current>(`/tenants/${id}/switch`);
    setTenantId(id);
    setCurrent(c);
  }, []);

  const signOut = useCallback(async () => {
    await post("/auth/logout").catch(() => {});
    setTenantId(null);
    setMe(null);
    setCurrent(null);
    setStatus("signedOut");
  }, []);

  const can = useCallback((perm: string) => !!current?.me.permissions.includes(perm), [current]);

  return <Ctx.Provider value={{ status, me, current, reload, reloadCurrent, openBusiness, signOut, can }}>{children}</Ctx.Provider>;
}

export const useSession = () => useContext(Ctx);
