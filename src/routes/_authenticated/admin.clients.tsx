import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { createClient, inviteUser } from "@/lib/admin.functions";
import { getMe } from "@/lib/me.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { EmptyState } from "@/components/empty-state";
import { toast } from "sonner";
import { Users, UserPlus } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/clients")({
  component: ClientsPage,
});

function ClientsPage() {
  const fetchMe = useServerFn(getMe);
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: () => fetchMe() });
  const queryClient = useQueryClient();

  const createFn = useServerFn(createClient);
  const inviteFn = useServerFn(inviteUser);

  const clientsQuery = useQuery({
    queryKey: ["admin-clients"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clients")
        .select("id, client_name, store_type, store_url, status, created_at")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const [newForm, setNewForm] = useState({ clientName: "", storeType: "shopify" as "shopify" | "woocommerce", storeUrl: "" });
  const [openInvite, setOpenInvite] = useState<string | null>(null);
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
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!me?.isAdmin) {
    return <EmptyState icon={Users} title="Admins only" description="Only agency and super admins can manage clients." />;
  }

  const rows = clientsQuery.data ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Clients</h1>
        <p className="text-sm text-muted-foreground">Create clients and invite users to submit products for each.</p>
      </div>

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

      {rows.length === 0 ? (
        <EmptyState icon={Users} title="No clients yet" description="Create your first client above to get started." />
      ) : (
        <Card className="overflow-hidden p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Client</TableHead>
                <TableHead>Platform</TableHead>
                <TableHead>Store URL</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">{c.client_name}</TableCell>
                  <TableCell className="capitalize">{c.store_type ?? "—"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{c.store_url ?? "—"}</TableCell>
                  <TableCell className="capitalize">{c.status}</TableCell>
                  <TableCell className="text-right">
                    <Dialog open={openInvite === c.id} onOpenChange={(o) => setOpenInvite(o ? c.id : null)}>
                      <DialogTrigger asChild>
                        <Button size="sm" variant="secondary">
                          <UserPlus className="mr-1.5 h-3.5 w-3.5" /> Invite user
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
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}