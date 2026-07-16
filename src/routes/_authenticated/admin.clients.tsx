import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import {
  createClient,
  inviteUser,
  listAgencies,
  assignAgency,
  listClientMembers,
  removeClientMember,
  resendInvite,
  updateMember,
  setMemberActive,
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
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/empty-state";
import { toast } from "sonner";
import { Users, UserPlus, CheckCircle2, Clock, Trash2, Mail, Pencil, Ban, Play } from "lucide-react";

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
  const agenciesFn = useServerFn(listAgencies);
  const assignFn = useServerFn(assignAgency);

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

  const agenciesQuery = useQuery({
    queryKey: ["agencies"],
    queryFn: () => agenciesFn(),
    enabled: !!me?.isSuperAdmin,
  });

  const [newForm, setNewForm] = useState({ clientName: "", storeType: "shopify" as "shopify" | "woocommerce", storeUrl: "" });
  const [openInvite, setOpenInvite] = useState<string | null>(null);
  const [openMembers, setOpenMembers] = useState<{ id: string; name: string } | null>(null);
  const [invite, setInvite] = useState({ email: "", fullName: "" });

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

  if (!allowed) return null;

  const rows = clientsQuery.data ?? [];
  const agencies = agenciesQuery.data ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Clients</h1>
        <p className="text-sm text-muted-foreground">Create clients and invite users to submit products for each.</p>
      </div>

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
                  <TableCell className="text-right space-x-2">
                    <Button size="sm" variant="ghost" onClick={() => setOpenMembers({ id: c.id, name: c.client_name })}>
                      <Users className="mr-1.5 h-3.5 w-3.5" /> Access
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
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const activeMut = useMutation({
    mutationFn: (v: { membershipId: string; active: boolean }) => setActiveFn({ data: v }),
    onSuccess: (_d, v) => {
      toast.success(v.active ? "Login reactivated" : "Login deactivated");
      queryClient.invalidateQueries({ queryKey: ["client-members", open?.id] });
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