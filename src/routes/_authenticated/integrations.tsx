import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { upsertIntegration, testIntegration } from "@/lib/integrations.functions";
import { useRoleGuard } from "@/hooks/use-role-guard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/empty-state";
import { toast } from "sonner";
import { CheckCircle2, Plug, XCircle } from "lucide-react";

export const Route = createFileRoute("/_authenticated/integrations")({
  component: IntegrationsPage,
});

function IntegrationsPage() {
  const { allowed } = useRoleGuard("admin");

  const clientsQuery = useQuery({
    queryKey: ["clients-integ"],
    queryFn: async () => {
      const { data, error } = await supabase.from("clients").select("id, client_name, store_type").order("client_name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const integsQuery = useQuery({
    queryKey: ["integrations"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("store_integrations")
        .select("id, client_id, platform, store_url, store_name, api_version, is_active, last_tested_at, last_test_status");
      if (error) throw error;
      return data ?? [];
    },
  });

  if (!allowed) return null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Store integrations</h1>
        <p className="text-sm text-muted-foreground">Connect Shopify or WooCommerce credentials per client. Credentials are encrypted at rest.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {(clientsQuery.data ?? []).map((c) => {
          const shopify = integsQuery.data?.find((i) => i.client_id === c.id && i.platform === "shopify");
          const woo = integsQuery.data?.find((i) => i.client_id === c.id && i.platform === "woocommerce");
          return (
            <Card key={c.id}>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <span>{c.client_name}</span>
                  <Badge variant="outline" className="capitalize">{c.store_type ?? "no default"}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <IntegrationForm clientId={c.id} platform="shopify" existing={shopify} />
                <IntegrationForm clientId={c.id} platform="woocommerce" existing={woo} />
              </CardContent>
            </Card>
          );
        })}
        {clientsQuery.isSuccess && (clientsQuery.data ?? []).length === 0 ? (
          <EmptyState icon={Plug} title="No clients yet" description="Create a client from the Clients page first." />
        ) : null}
      </div>
    </div>
  );
}

function IntegrationForm({ clientId, platform, existing }: { clientId: string; platform: "shopify" | "woocommerce"; existing?: any }) {
  const [form, setForm] = useState({
    storeUrl: existing?.store_url ?? "",
    storeName: existing?.store_name ?? "",
    apiVersion: existing?.api_version ?? (platform === "shopify" ? "2024-07" : ""),
    accessToken: "",
    consumerKey: "",
    consumerSecret: "",
    isActive: existing?.is_active ?? true,
  });
  const queryClient = useQueryClient();
  const upsertFn = useServerFn(upsertIntegration);
  const testFn = useServerFn(testIntegration);

  const save = useMutation({
    mutationFn: () => upsertFn({
      data: {
        clientId,
        platform,
        storeUrl: form.storeUrl,
        storeName: form.storeName || null,
        apiVersion: form.apiVersion || null,
        accessToken: platform === "shopify" && form.accessToken ? form.accessToken : null,
        consumerKey: platform === "woocommerce" && form.consumerKey ? form.consumerKey : null,
        consumerSecret: platform === "woocommerce" && form.consumerSecret ? form.consumerSecret : null,
        isActive: form.isActive,
      } as any,
    }),
    onSuccess: () => {
      toast.success("Integration saved");
      queryClient.invalidateQueries({ queryKey: ["integrations"] });
      setForm({ ...form, accessToken: "", consumerKey: "", consumerSecret: "" });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const test = useMutation({
    mutationFn: () => testFn({ data: { integrationId: existing!.id } }),
    onSuccess: (res) => {
      if (res.ok) toast.success(res.message); else toast.error(res.message);
      queryClient.invalidateQueries({ queryKey: ["integrations"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="rounded-lg border p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold capitalize">{platform}</div>
        {existing?.last_test_status === "success" ? (
          <Badge className="bg-emerald-100 text-emerald-800 border-transparent"><CheckCircle2 className="h-3 w-3 mr-1" /> OK</Badge>
        ) : existing?.last_test_status === "failure" ? (
          <Badge className="bg-red-100 text-red-800 border-transparent"><XCircle className="h-3 w-3 mr-1" /> Failed</Badge>
        ) : null}
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1.5 md:col-span-2">
          <Label>Store URL</Label>
          <Input placeholder={platform === "shopify" ? "https://store.myshopify.com" : "https://store.com"} value={form.storeUrl} onChange={(e) => setForm({ ...form, storeUrl: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label>Store name</Label>
          <Input value={form.storeName} onChange={(e) => setForm({ ...form, storeName: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label>API version</Label>
          <Input value={form.apiVersion} onChange={(e) => setForm({ ...form, apiVersion: e.target.value })} />
        </div>
        {platform === "shopify" ? (
          <div className="space-y-1.5 md:col-span-2">
            <Label>Admin API access token {existing?.enc_access_token ? "(leave blank to keep)" : ""}</Label>
            <Input type="password" value={form.accessToken} onChange={(e) => setForm({ ...form, accessToken: e.target.value })} />
          </div>
        ) : (
          <>
            <div className="space-y-1.5">
              <Label>Consumer key</Label>
              <Input type="password" value={form.consumerKey} onChange={(e) => setForm({ ...form, consumerKey: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Consumer secret</Label>
              <Input type="password" value={form.consumerSecret} onChange={(e) => setForm({ ...form, consumerSecret: e.target.value })} />
            </div>
          </>
        )}
        <div className="space-y-1.5">
          <Label>Active</Label>
          <Select value={String(form.isActive)} onValueChange={(v) => setForm({ ...form, isActive: v === "true" })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="true">Yes</SelectItem>
              <SelectItem value="false">No</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="flex gap-2 justify-end">
        {existing ? (
          <Button variant="outline" onClick={() => test.mutate()} disabled={test.isPending}>Test connection</Button>
        ) : null}
        <Button onClick={() => save.mutate()} disabled={save.isPending}>Save</Button>
      </div>
    </div>
  );
}