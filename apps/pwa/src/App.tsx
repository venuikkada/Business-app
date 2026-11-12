import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { useEffect, type ReactElement } from "react";
import { useSession } from "./lib/session";
import { useI18n, LANGS, type Lang } from "./i18n";
import { Layout } from "./components/Layout";
import { Loading } from "./components/ui";
import { Login } from "./pages/Login";
import { Onboarding } from "./pages/Onboarding";
import { PickBusiness } from "./pages/PickBusiness";
import { Home } from "./pages/Home";
import { Team } from "./pages/Team";
import { Roles } from "./pages/Roles";
import { Audit } from "./pages/Audit";
import { Settings } from "./pages/Settings";
import { Account } from "./pages/Account";
import { Notifications } from "./pages/Notifications";
import { DocEditor, DocView, SalesList } from "./pages/Sales";
import { Items } from "./pages/Items";
import { Parties } from "./pages/Parties";
import { Employees, Payroll } from "./pages/People";

function Guard({ perm, children }: { perm: string; children: ReactElement }) {
  const { can } = useSession();
  return can(perm) ? children : <Navigate to="/" replace />;
}

export function App() {
  const { status, me, current } = useSession();
  const { lang, setLang } = useI18n();

  // Use the language saved on the profile when signing in on a new device.
  useEffect(() => {
    const l = me?.user.language as Lang | undefined;
    if (l && l in LANGS && l !== lang && !localStorage.getItem("cb.lang")) setLang(l);
  }, [me, lang, setLang]);

  if (status === "loading") return <Loading />;

  return (
    <BrowserRouter>
      {status === "signedOut" || !me ? (
        <Routes>
          <Route path="*" element={<Login />} />
        </Routes>
      ) : me.businesses.length === 0 ? (
        <Routes>
          <Route path="*" element={<Onboarding />} />
        </Routes>
      ) : !current ? (
        <Routes>
          <Route path="/onboarding" element={<Onboarding />} />
          <Route path="*" element={<PickBusiness />} />
        </Routes>
      ) : (
        <Routes>
          <Route path="/onboarding" element={<Onboarding />} />
          <Route path="/switch" element={<PickBusiness />} />
          <Route element={<Layout />}>
            <Route index element={<Home />} />
            <Route path="invoices" element={<Guard perm="sales.view"><SalesList docType="invoice" /></Guard>} />
            <Route path="quotations" element={<Guard perm="sales.view"><SalesList docType="quotation" /></Guard>} />
            <Route path="invoices/new" element={<Guard perm="sales.create"><DocEditor key="inv" docType="invoice" /></Guard>} />
            <Route path="quotations/new" element={<Guard perm="sales.create"><DocEditor key="qt" docType="quotation" /></Guard>} />
            <Route path="sales/:id" element={<Guard perm="sales.view"><DocView /></Guard>} />
            <Route path="customers" element={<Guard perm="parties.view"><Parties /></Guard>} />
            <Route path="items" element={<Guard perm="items.view"><Items key="items" mode="items" /></Guard>} />
            <Route path="stock" element={<Guard perm="stock.view"><Items key="stock" mode="stock" /></Guard>} />
            <Route path="employees" element={<Guard perm="employees.view"><Employees /></Guard>} />
            <Route path="payroll" element={<Guard perm="payroll.view"><Payroll /></Guard>} />
            <Route path="team" element={<Guard perm="team.view"><Team /></Guard>} />
            <Route path="roles" element={<Guard perm="roles.view"><Roles /></Guard>} />
            <Route path="audit" element={<Guard perm="audit.view"><Audit /></Guard>} />
            <Route path="settings" element={<Guard perm="settings.view"><Settings /></Guard>} />
            <Route path="account" element={<Account />} />
            <Route path="notifications" element={<Notifications />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      )}
    </BrowserRouter>
  );
}
