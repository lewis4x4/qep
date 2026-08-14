import { useLocation } from "react-router-dom";
import { shouldShowLoginForUnauthenticatedPath } from "@/lib/auth-route-bootstrap";
import { LoginPage } from "./LoginPage";
import { NotFoundPage } from "./NotFoundPage";

export function UnauthenticatedCatchAll({
  authError,
}: {
  authError?: string | null;
}): React.ReactElement {
  const { pathname } = useLocation();

  if (shouldShowLoginForUnauthenticatedPath(pathname)) {
    return <LoginPage authError={authError} />;
  }

  return <NotFoundPage audience="public" />;
}

export default UnauthenticatedCatchAll;
