import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import {
  createClient,
  inviteUser,
  createClientLogin,
  listAgencies,
  assignAgency,
  listClientMembers,
  listMemberSummaries,
  removeClientMember,
  resendInvite,
  updateMember,
  setMemberActive,
  setMyExclusiveClient,
  updateClient,
  deleteClient,
} from "@/lib/admin.functions";
import { getMe } from "@/lib/me.functions";
import { useRoleGuard } from "@/hooks/use-role-guard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/empty-state";
import { toast } from "sonner";
import { Users, UserPlus, CheckCircle2, Clock, Trash2, Mail, Pencil, Ban, Play, UserCheck, KeyRound } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/clients")({
  component: ClientsPage,
});

function ClientsPage() {
  const { allowed } = useRoleGuard("admin");
  const fetchMe = useServerFn(getMe);
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: () => fetchMe() });
  const queryClient = useQueryClient();

  const createFn = useServerFn(createClient);
  const inviteFn = useServerFn(inviteUser);
  const createLoginFn = useServerFn(createClientLogin);
  const agenciesFn = useServerFn(listAgencies);
  const assignFn = useServerFn(assignAgency);
  const setMineFn = useServerFn(setMyExclusiveClient);
  const updateClientFn = useServerFn(updateClient);
  const deleteClientFn = useServerFn(deleteClient);
  const summariesFn = useServerFn(listMemberSummaries);
  const updateMemberFn = useServerFn(updateMember);

  const clientsQuery = useQuery({
    queryKey: ["admin-clients"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clients")
        .select("id, client_name, store_type, store_url, status, agency_id, created_at")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const clientIds = (clientsQuery.data ?? []).map((c) => c.id);
  const summariesQuery = useQuery({
    queryKey: ["client-member-summaries", clientIds.join(",")],
    queryFn: () => summariesFn({ data: { clientIds } }),
    enabled: clientIds.length > 0,
  });
  const summariesByClient = new Map<string, { membershipId: string; email: string | null; fullName: string | null; userId: string }[]>();
  (summariesQuery.data ?? []).forEach((s) => {
    const arr = summariesByClient.get(s.clientId) ?? [];
    arr.push({ membershipId: (s as any).membershipId, email: s.email, fullName: s.fullName, userId: s.userId });
    summariesByClient.set(s.clientId, arr);
  });

  const agenciesQuery = useQuery({
    queryKey: ["agencies"],
    queryFn: () => agenciesFn(),
    enabled: !!me?.isSuperAdmin,
  });

  const [newForm, setNewForm] = useState({ clientName: "", storeType: "shopify" as "shopify" | "woocommerce", storeUrl: "" });
  const [openInvite, setOpenInvite] = useState<string | null>(null);
  const [openLogin, setOpenLogin] = useState<string | null>(null);
  const [openMembers, setOpenMembers] = useState<{ id: string; name: string } | null>(null);
  const [invite, setInvite] = useState({ email: "", fullName: "" });
  const [loginForm, setLoginForm] = useState({ email: "", password: "", fullName: "" });
  const [editing, setEditing] = useState<null | {
    id: string;
    clientName: string;
    storeType: "shopify" | "woocommerce" | "";
    storeUrl: string;
    status: "active" | "inactive";
  }>(null);
  const [confirmDelete, setConfirmDelete] = useState<null | { id: string; name: string }>(null);
  const [editLogin, setEditLogin] = useState<null | {
    membershipId: string;
    clientName: string;
    currentEmail: string | null;
    email: string;
    password: string;
    lastResetPassword?: string;
  }>(null);

  const createMut = useMutation({
    mutationFn: () => createFn({ data: newForm }),
    onSuccess: () => {
      toast.success("Client created");
      setNewForm({ clientName: "", storeType: "shopify", storeUrl: "" });
      queryClient.invalidateQueries({ queryKey: ["admin-clients"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const inviteMut = useMutation({
    mutationFn: (clientId: string) => inviteFn({ data: { clientId, ...invite, role: "client" } }),
    onSuccess: () => {
      toast.success("Invitation sent");
      setOpenInvite(null);
      setInvite({ email: "", fullName: "" });
      queryClient.invalidateQueries({ queryKey: ["client-members"] });
      queryClient.invalidateQueries({ queryKey: ["client-member-summaries"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const createLoginMut = useMutation({
    mutationFn: (clientId: string) => createLoginFn({ data: { clientId, ...loginForm } }),
    onSuccess: () => {
      toast.success("Login created — share the credentials with the user");
      setOpenLogin(null);
      setLoginForm({ email: "", password: "", fullName: "" });
      queryClient.invalidateQueries({ queryKey: ["client-members"] });
      queryClient.invalidateQueries({ queryKey: ["client-member-summaries"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const assignMut = useMutation({
    mutationFn: (v: { clientId: string; agencyId: string | null }) => assignFn({ data: v }),
    onSuccess: () => {
      toast.success("Agency assigned");
      queryClient.invalidateQueries({ queryKey: ["admin-clients"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const setMineMut = useMutation({
    mutationFn: (clientId: string) => setMineFn({ data: { clientId } }),
    onSuccess: (res) => {
      const removed = res?.removedClientIds?.length ?? 0;
      toast.success(
        removed > 0
          ? `You're now the only client member here (removed from ${removed} other${removed === 1 ? "" : "s"}).`
          : "You're now a member of this client.",
      );
      queryClient.invalidateQueries({ queryKey: ["me"] });
      queryClient.invalidateQueries({ queryKey: ["client-members"] });
      queryClient.invalidateQueries({ queryKey: ["client-member-summaries"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateClientMut = useMutation({
    mutationFn: (v: {
      clientId: string;
      clientName?: string;
      storeType?: "shopify" | "woocommerce" | null;
      storeUrl?: string | null;
      status?: "active" | "inactive";
    }) => updateClientFn({ data: v }),
    onSuccess: () => {
      toast.success("Client updated");
      setEditing(null);
      queryClient.invalidateQueries({ queryKey: ["admin-clients"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteClientMut = useMutation({
    mutationFn: (args: { clientId: string; force?: boolean }) =>
      deleteClientFn({ data: args }),
    onSuccess: () => {
      toast.success("Client deleted");
      setConfirmDelete(null);
      queryClient.invalidateQueries({ queryKey: ["admin-clients"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const editLoginMut = useMutation({
    mutationFn: (v: { membershipId: string; email?: string; newPassword?: string }) =>
      updateMemberFn({ data: v }).then((r) => ({ result: r, input: v })),
    onSuccess: ({ input }) => {
      const changed: string[] = [];
      if (input.email) changed.push(`email → ${input.email}`);
      if (input.newPassword) changed.push("password reset");
      toast.success(
        input.newPassword ? "Password reset successfully" : "Login updated",
        { description: changed.join(" · ") || "No changes", duration: 6000 },
      );
      if (input.newPassword && editLogin) {
        setEditLogin({ ...editLogin, password: "", currentEmail: input.email ?? editLogin.currentEmail, lastResetPassword: input.newPassword });
      } else {
        setEditLogin(null);
      }
      queryClient.invalidateQueries({ queryKey: ["client-member-summaries"] });
      queryClient.invalidateQueries({ queryKey: ["client-members"] });
    },
    onError: (e: Error) =>
      toast.error("Couldn't update login", { description: e.message, duration: 10000 }),
  });

  if (!allowed) return null;

  const rows = clientsQuery.data ?? [];
  const agencies = agenciesQuery.data ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Clients</h1>
        <p className="text-sm text-muted-foreground">Create clients and invite users to submit products for each.</p>
      </div>

      {me ? (
        <Card>
          <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-2 py-3 text-sm">
            <span className="text-muted-foreground">Signed in as</span>
            <span className="font-medium">{me.fullName || me.email || "—"}</span>
            {me.email ? <span className="text-muted-foreground">{me.email}</span> : null}
            <span className="text-muted-foreground">User ID:</span>
            <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{me.userId}</code>
            {me.roles.length ? (
              <div className="flex items-center gap-1.5">
                {me.roles.map((r) => (
                  <Badge key={r} variant="outline" className="capitalize">{r.replace("_", " ")}</Badge>
                ))}
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {me?.isSuperAdmin ? (
      <Card>
        <CardHeader><CardTitle>New client</CardTitle></CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-4">
          <div className="space-y-1.5">
            <Label>Client name *</Label>
            <Input value={newForm.clientName} onChange={(e) => setNewForm({ ...newForm, clientName: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label>Platform</Label>
            <Select value={newForm.storeType} onValueChange={(v) => setNewForm({ ...newForm, storeType: v as any })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="shopify">Shopify</SelectItem>
                <SelectItem value="woocommerce">WooCommerce</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Store URL</Label>
            <Input placeholder="https://…" value={newForm.storeUrl} onChange={(e) => setNewForm({ ...newForm, storeUrl: e.target.value })} />
          </div>
          <div className="flex items-end">
            <Button className="w-full" onClick={() => createMut.mutate()} disabled={createMut.isPending || !newForm.clientName}>
              Create
            </Button>
          </div>
        </CardContent>
      </Card>
      ) : null}

      {rows.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No clients yet"
          description={
            me?.isSuperAdmin
              ? "Create your first client above to get started."
              : "A super admin needs to create and assign clients to you."
          }
        />
      ) : (
        <Card className="overflow-hidden p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Client</TableHead>
                <TableHead>Platform</TableHead>
                {me?.isSuperAdmin ? <TableHead>Agency</TableHead> : null}
                <TableHead>Status</TableHead>
                <TableHead>Logins</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">
                    <div>{c.client_name}</div>
                    {c.store_url ? <div className="text-xs text-muted-foreground">{c.store_url}</div> : null}
                  </TableCell>
                  <TableCell className="capitalize">{c.store_type ?? "—"}</TableCell>
                  {me?.isSuperAdmin ? (
                    <TableCell>
                      <Select
                        value={c.agency_id ?? "none"}
                        onValueChange={(v) => assignMut.mutate({ clientId: c.id, agencyId: v === "none" ? null : v })}
                      >
                        <SelectTrigger className="h-8 w-[200px]"><SelectValue placeholder="Unassigned" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Unassigned</SelectItem>
                          {agencies.map((a) => (
                            <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                  ) : null}
                  <TableCell className="capitalize">{c.status}</TableCell>
                  <TableCell>
                    {(() => {
                      const list = summariesByClient.get(c.id) ?? [];
                      if (summariesQuery.isLoading) return <span className="text-xs text-muted-foreground">…</span>;
                      if (list.length === 0) return <span className="text-xs text-muted-foreground">None</span>;
                      return (
                        <div className="flex flex-col gap-0.5">
                          {list.map((m) => (
                            <div key={m.userId} className="flex items-center gap-2">
                              <span className="text-xs">{m.email ?? m.fullName ?? m.userId}</span>
                              <button
                                type="button"
                                className="text-xs text-primary hover:underline"
                                onClick={() =>
                                  setEditLogin({
                                    membershipId: m.membershipId,
                                    clientName: c.client_name,
                                    currentEmail: m.email,
                                    email: m.email ?? "",
                                    password: "",
                                  })
                                }
                              >
                                Edit
                              </button>
                            </div>
                          ))}
                        </div>
                      );
                    })()}
                  </TableCell>
                  <TableCell className="text-right space-x-2">
                    <Button size="sm" variant="ghost" onClick={() => setOpenMembers({ id: c.id, name: c.client_name })}>
                      <Users className="mr-1.5 h-3.5 w-3.5" /> Access
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        setEditing({
                          id: c.id,
                          clientName: c.client_name,
                          storeType: (c.store_type as any) ?? "",
                          storeUrl: c.store_url ?? "",
                          status: (c.status as any) ?? "active",
                        })
                      }
                    >
                      <Pencil className="mr-1.5 h-3.5 w-3.5" /> Edit
                    </Button>
                    {me?.isSuperAdmin ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive hover:text-destructive"
                        onClick={() => setConfirmDelete({ id: c.id, name: c.client_name })}
                      >
                        <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Delete
                      </Button>
                    ) : null}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        if (confirm(`Make ${c.client_name} your only assigned client? You'll be removed from any others.`)) {
                          setMineMut.mutate(c.id);
                        }
                      }}
                      disabled={setMineMut.isPending}
                      title="Set as my only client"
                    >
                      <UserCheck className="mr-1.5 h-3.5 w-3.5" />
                      {me?.clientIds?.length === 1 && me.clientIds[0] === c.id ? "My client" : "Set as mine"}
                    </Button>
                    {me?.isSuperAdmin ? (
                    <Dialog open={openInvite === c.id} onOpenChange={(o) => setOpenInvite(o ? c.id : null)}>
                      <DialogTrigger asChild>
                        <Button size="sm" variant="secondary">
                          <UserPlus className="mr-1.5 h-3.5 w-3.5" /> Invite
                        </Button>
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader><DialogTitle>Invite user to {c.client_name}</DialogTitle></DialogHeader>
                        <div className="space-y-3">
                          <div className="space-y-1.5">
                            <Label>Email</Label>
                            <Input type="email" value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} />
                          </div>
                          <div className="space-y-1.5">
                            <Label>Full name (optional)</Label>
                            <Input value={invite.fullName} onChange={(e) => setInvite({ ...invite, fullName: e.target.value })} />
                          </div>
                          <Button
                            className="w-full"
                            onClick={() => inviteMut.mutate(c.id)}
                            disabled={inviteMut.isPending || !invite.email}
                          >
                            Send invitation
                          </Button>
                        </div>
                      </DialogContent>
                    </Dialog>
                    ) : null}
                    {me?.isSuperAdmin ? (
                    <Dialog open={openLogin === c.id} onOpenChange={(o) => setOpenLogin(o ? c.id : null)}>
                      <DialogTrigger asChild>
                        <Button size="sm" variant="secondary">
                          <KeyRound className="mr-1.5 h-3.5 w-3.5" /> Create login
                        </Button>
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader><DialogTitle>Create login for {c.client_name}</DialogTitle></DialogHeader>
                        <div className="space-y-3">
                          <div className="space-y-1.5">
                            <Label>Email</Label>
                            <Input type="email" value={loginForm.email} onChange={(e) => setLoginForm({ ...loginForm, email: e.target.value })} />
                          </div>
                          <div className="space-y-1.5">
                            <Label>Password</Label>
                            <Input
                              type="text"
                              placeholder="Min 8 characters"
                              value={loginForm.password}
                              onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })}
                            />
                            <p className="text-xs text-muted-foreground">
                              Share these credentials with the user securely. Email is auto-confirmed — they can sign in immediately.
                            </p>
                          </div>
                          <div className="space-y-1.5">
                            <Label>Full name (optional)</Label>
                            <Input value={loginForm.fullName} onChange={(e) => setLoginForm({ ...loginForm, fullName: e.target.value })} />
                          </div>
                          <Button
                            className="w-full"
                            onClick={() => createLoginMut.mutate(c.id)}
                            disabled={createLoginMut.isPending || !loginForm.email || loginForm.password.length < 8}
                          >
                            Create login
                          </Button>
                        </div>
                      </DialogContent>
                    </Dialog>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      <MembersDialog
        open={openMembers}
        onClose={() => setOpenMembers(null)}
      />

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit client</DialogTitle></DialogHeader>
          {editing ? (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Client name *</Label>
                <Input
                  value={editing.clientName}
                  onChange={(e) => setEditing({ ...editing, clientName: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Platform</Label>
                <Select
                  value={editing.storeType || "none"}
                  onValueChange={(v) => setEditing({ ...editing, storeType: v === "none" ? "" : (v as any) })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Unspecified</SelectItem>
                    <SelectItem value="shopify">Shopify</SelectItem>
                    <SelectItem value="woocommerce">WooCommerce</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Store URL</Label>
                <Input
                  placeholder="https://…"
                  value={editing.storeUrl}
                  onChange={(e) => setEditing({ ...editing, storeUrl: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Status</Label>
                <Select
                  value={editing.status}
                  onValueChange={(v) => setEditing({ ...editing, status: v as any })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button
                className="w-full"
                disabled={updateClientMut.isPending || !editing.clientName.trim()}
                onClick={() =>
                  updateClientMut.mutate({
                    clientId: editing.id,
                    clientName: editing.clientName.trim(),
                    storeType: editing.storeType === "" ? null : editing.storeType,
                    storeUrl: editing.storeUrl.trim() || null,
                    status: editing.status,
                  })
                }
              >
                Save changes
              </Button>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {confirmDelete?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the client, its member logins, and any store integrations.
              Products must be deleted or reassigned first — otherwise the delete will be blocked.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive/80 text-destructive-foreground hover:bg-destructive"
              disabled={deleteClientMut.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (confirmDelete) deleteClientMut.mutate({ clientId: confirmDelete.id, force: true });
              }}
            >
              Force delete (with products)
            </AlertDialogAction>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteClientMut.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (confirmDelete) deleteClientMut.mutate({ clientId: confirmDelete.id });
              }}
            >
              Delete client
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={!!editLogin} onOpenChange={(o) => !o && setEditLogin(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit login {editLogin ? `for ${editLogin.clientName}` : ""}</DialogTitle>
          </DialogHeader>
          {editLogin ? (
            <div className="space-y-3">
              {editLogin.lastResetPassword ? (
                <div className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm">
                  <div className="flex items-center gap-2 font-medium text-emerald-800">
                    <CheckCircle2 className="h-4 w-4" /> Password reset successfully
                  </div>
                  <p className="mt-1 text-xs text-emerald-700">
                    Share this password securely — it won't be shown again.
                  </p>
                  <div className="mt-2 flex items-center gap-2">
                    <code className="flex-1 rounded bg-white px-2 py-1 text-xs break-all border">
                      {editLogin.lastResetPassword}
                    </code>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        navigator.clipboard.writeText(editLogin.lastResetPassword!);
                        toast.success("Password copied to clipboard");
                      }}
                    >
                      Copy
                    </Button>
                  </div>
                </div>
              ) : null}
              <div className="space-y-1.5">
                <Label>Email</Label>
                <Input
                  type="email"
                  value={editLogin.email}
                  onChange={(e) => setEditLogin({ ...editLogin, email: e.target.value })}
                />
                {editLogin.currentEmail ? (
                  <p className="text-xs text-muted-foreground">Current: {editLogin.currentEmail}</p>
                ) : null}
              </div>
              <div className="space-y-1.5">
                <Label>New password (optional)</Label>
                <Input
                  type="text"
                  placeholder="Leave blank to keep current"
                  value={editLogin.password}
                  onChange={(e) => setEditLogin({ ...editLogin, password: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">Min 8 characters if changing.</p>
              </div>
              <Button
                className="w-full"
                disabled={
                  editLoginMut.isPending ||
                  (editLogin.email === (editLogin.currentEmail ?? "") && editLogin.password.length === 0) ||
                  (editLogin.password.length > 0 && editLogin.password.length < 8) ||
                  !editLogin.email
                }
                onClick={() => {
                  const payload: { membershipId: string; email?: string; newPassword?: string } = {
                    membershipId: editLogin.membershipId,
                  };
                  if (editLogin.email && editLogin.email !== editLogin.currentEmail) payload.email = editLogin.email;
                  if (editLogin.password.length >= 8) payload.newPassword = editLogin.password;
                  editLoginMut.mutate(payload);
                }}
              >
                Save changes
              </Button>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function MembersDialog({ open, onClose }: { open: { id: string; name: string } | null; onClose: () => void }) {
  const listFn = useServerFn(listClientMembers);
  const removeFn = useServerFn(removeClientMember);
  const resendFn = useServerFn(resendInvite);
  const updateFn = useServerFn(updateMember);
  const setActiveFn = useServerFn(setMemberActive);
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<{ id: string; fullName: string; password: string } | null>(null);

  const membersQuery = useQuery({
    queryKey: ["client-members", open?.id],
    queryFn: () => listFn({ data: { clientId: open!.id } }),
    enabled: !!open,
  });

  const removeMut = useMutation({
    mutationFn: (membershipId: string) => removeFn({ data: { membershipId } }),
    onSuccess: () => {
      toast.success("Access removed");
      queryClient.invalidateQueries({ queryKey: ["client-members", open?.id] });
      queryClient.invalidateQueries({ queryKey: ["client-member-summaries"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const resendMut = useMutation({
    mutationFn: (email: string) => resendFn({ data: { email } }),
    onSuccess: () => toast.success("Invitation re-sent"),
    onError: (e: Error) => toast.error(e.message),
  });

  const updateMut = useMutation({
    mutationFn: (v: { membershipId: string; fullName?: string; newPassword?: string }) =>
      updateFn({ data: v }),
    onSuccess: () => {
      toast.success("Login updated");
      setEditing(null);
      queryClient.invalidateQueries({ queryKey: ["client-members", open?.id] });
      queryClient.invalidateQueries({ queryKey: ["client-member-summaries"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const activeMut = useMutation({
    mutationFn: (v: { membershipId: string; active: boolean }) => setActiveFn({ data: v }),
    onSuccess: (_d, v) => {
      toast.success(v.active ? "Login reactivated" : "Login deactivated");
      queryClient.invalidateQueries({ queryKey: ["client-members", open?.id] });
      queryClient.invalidateQueries({ queryKey: ["client-member-summaries"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const members = membersQuery.data ?? [];

  return (
    <Dialog open={!!open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>Access for {open?.name}</DialogTitle></DialogHeader>
        {membersQuery.isLoading ? (
          <div className="text-sm text-muted-foreground py-6">Loading…</div>
        ) : members.length === 0 ? (
          <div className="text-sm text-muted-foreground py-6">No users have access yet. Use Invite to add one.</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((m) => (
                <TableRow key={m.membershipId}>
                  <TableCell>
                    <div className="font-medium">{m.fullName || m.email || m.userId}</div>
                    {m.email ? <div className="text-xs text-muted-foreground">{m.email}</div> : null}
                  </TableCell>
                  <TableCell className="text-xs capitalize">{m.roles.join(", ") || "—"}</TableCell>
                  <TableCell>
                    {m.banned ? (
                      <Badge variant="outline" className="border-red-300 text-red-700">
                        <Ban className="h-3 w-3 mr-1" /> Deactivated
                      </Badge>
                    ) : m.confirmed ? (
                      <Badge className="bg-emerald-100 text-emerald-800 border-transparent">
                        <CheckCircle2 className="h-3 w-3 mr-1" /> Confirmed
                      </Badge>
                    ) : (
                      <Badge variant="outline"><Clock className="h-3 w-3 mr-1" /> Pending</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right space-x-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setEditing({ id: m.membershipId, fullName: m.fullName ?? "", password: "" })}
                      title="Edit login"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => activeMut.mutate({ membershipId: m.membershipId, active: m.banned })}
                      disabled={activeMut.isPending}
                      title={m.banned ? "Reactivate login" : "Deactivate login"}
                    >
                      {m.banned ? <Play className="h-3.5 w-3.5 text-emerald-600" /> : <Ban className="h-3.5 w-3.5 text-amber-600" />}
                    </Button>
                    {!m.confirmed && m.email ? (
                      <Button size="sm" variant="ghost" onClick={() => resendMut.mutate(m.email!)} disabled={resendMut.isPending}>
                        <Mail className="h-3.5 w-3.5" />
                      </Button>
                    ) : null}
                    <Button size="sm" variant="ghost" onClick={() => removeMut.mutate(m.membershipId)} disabled={removeMut.isPending}>
                      <Trash2 className="h-3.5 w-3.5 text-red-600" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
          <DialogContent>
            <DialogHeader><DialogTitle>Edit login</DialogTitle></DialogHeader>
            {editing ? (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label>Full name</Label>
                  <Input
                    value={editing.fullName}
                    onChange={(e) => setEditing({ ...editing, fullName: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Reset password (optional)</Label>
                  <Input
                    type="text"
                    placeholder="Leave blank to keep current password"
                    value={editing.password}
                    onChange={(e) => setEditing({ ...editing, password: e.target.value })}
                  />
                  <p className="text-xs text-muted-foreground">Minimum 8 characters. Share it with the user securely.</p>
                </div>
                <Button
                  className="w-full"
                  disabled={updateMut.isPending}
                  onClick={() =>
                    updateMut.mutate({
                      membershipId: editing.id,
                      fullName: editing.fullName,
                      newPassword: editing.password ? editing.password : undefined,
                    })
                  }
                >
                  Save changes
                </Button>
              </div>
            ) : null}
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  );
}