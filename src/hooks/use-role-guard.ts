import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getMe, type MePayload } from "@/lib/me.functions";

type Requirement = "admin" | "superAdmin";

export function useRoleGuard(requirement: Requirement) {
  const navigate = useNavigate();
  const fetchMe = useServerFn(getMe);
  const { data: me, isLoading } = useQuery({ queryKey: ["me"], queryFn: () => fetchMe() });

  const allowed = isAllowed(me, requirement);

  useEffect(() => {
    if (isLoading || !me) return;
    if (!allowed) {
      navigate({
        to: "/unauthorized",
        search: { required: requirement },
        replace: true,
      });
    }
  }, [isLoading, me, allowed, requirement, navigate]);

  return { me, isLoading, allowed };
}

function isAllowed(me: MePayload | undefined, requirement: Requirement) {
  if (!me) return false;
  if (requirement === "superAdmin") return me.isSuperAdmin;
  return me.isAdmin;
}