
-- =========================================================================
-- ENUMS
-- =========================================================================
CREATE TYPE public.app_role AS ENUM ('super_admin', 'agency_admin', 'client');
CREATE TYPE public.store_platform AS ENUM ('shopify', 'woocommerce');
CREATE TYPE public.product_status AS ENUM ('draft', 'submitted', 'approved', 'published', 'failed', 'rejected');
CREATE TYPE public.client_status AS ENUM ('active', 'inactive');
CREATE TYPE public.log_action AS ENUM ('publish', 'test_connection', 'export');
CREATE TYPE public.log_status AS ENUM ('success', 'failure');

-- =========================================================================
-- updated_at helper
-- =========================================================================
CREATE OR REPLACE FUNCTION public.tg_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

-- =========================================================================
-- PROFILES
-- =========================================================================
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  email TEXT,
  company_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER trg_profiles_updated
BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- =========================================================================
-- USER ROLES
-- =========================================================================
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

CREATE OR REPLACE FUNCTION public.is_admin(_user_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS(
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role IN ('super_admin','agency_admin')
  );
$$;

-- Policies for profiles
CREATE POLICY "Users read own profile" ON public.profiles FOR SELECT TO authenticated
USING (auth.uid() = id OR public.is_admin(auth.uid()));
CREATE POLICY "Users insert own profile" ON public.profiles FOR INSERT TO authenticated
WITH CHECK (auth.uid() = id);
CREATE POLICY "Users update own profile" ON public.profiles FOR UPDATE TO authenticated
USING (auth.uid() = id OR public.is_admin(auth.uid()))
WITH CHECK (auth.uid() = id OR public.is_admin(auth.uid()));

-- Policies for user_roles
CREATE POLICY "Users read own roles" ON public.user_roles FOR SELECT TO authenticated
USING (auth.uid() = user_id OR public.is_admin(auth.uid()));
-- Admin writes handled via service_role in server functions only.

-- =========================================================================
-- CLIENTS
-- =========================================================================
CREATE TABLE public.clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  client_name TEXT NOT NULL,
  store_type public.store_platform,
  store_url TEXT,
  status public.client_status NOT NULL DEFAULT 'active',
  primary_contact_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.clients TO authenticated;
GRANT ALL ON public.clients TO service_role;
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_clients_updated BEFORE UPDATE ON public.clients
FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- =========================================================================
-- CLIENT MEMBERS (users <-> clients)
-- =========================================================================
CREATE TABLE public.client_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (client_id, user_id)
);
GRANT SELECT, INSERT, DELETE ON public.client_members TO authenticated;
GRANT ALL ON public.client_members TO service_role;
ALTER TABLE public.client_members ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.user_belongs_to_client(_user_id UUID, _client_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS(SELECT 1 FROM public.client_members WHERE user_id = _user_id AND client_id = _client_id);
$$;

CREATE POLICY "Members read own memberships" ON public.client_members FOR SELECT TO authenticated
USING (user_id = auth.uid() OR public.is_admin(auth.uid()));
CREATE POLICY "Admins manage memberships insert" ON public.client_members FOR INSERT TO authenticated
WITH CHECK (public.is_admin(auth.uid()));
CREATE POLICY "Admins manage memberships delete" ON public.client_members FOR DELETE TO authenticated
USING (public.is_admin(auth.uid()));

-- Clients policies
CREATE POLICY "Clients read own client" ON public.clients FOR SELECT TO authenticated
USING (public.is_admin(auth.uid()) OR public.user_belongs_to_client(auth.uid(), id));
CREATE POLICY "Admins insert clients" ON public.clients FOR INSERT TO authenticated
WITH CHECK (public.is_admin(auth.uid()));
CREATE POLICY "Admins update clients" ON public.clients FOR UPDATE TO authenticated
USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
CREATE POLICY "Admins delete clients" ON public.clients FOR DELETE TO authenticated
USING (public.is_admin(auth.uid()));

-- =========================================================================
-- PRODUCTS
-- =========================================================================
CREATE TABLE public.products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  short_description TEXT,
  price NUMERIC(12,2),
  compare_at_price NUMERIC(12,2),
  cost_price NUMERIC(12,2),
  sku TEXT,
  barcode TEXT,
  inventory_quantity INTEGER DEFAULT 0,
  category TEXT,
  product_type TEXT,
  vendor TEXT,
  tags TEXT[] DEFAULT '{}',
  collection_name TEXT,
  woo_category TEXT,
  seo_title TEXT,
  seo_description TEXT,
  slug TEXT,
  status public.product_status NOT NULL DEFAULT 'draft',
  rejection_note TEXT,
  platform_product_id TEXT,
  published_url TEXT,
  published_platform public.store_platform,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.products TO authenticated;
GRANT ALL ON public.products TO service_role;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_products_updated BEFORE UPDATE ON public.products
FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE INDEX idx_products_client ON public.products(client_id);
CREATE INDEX idx_products_status ON public.products(status);

CREATE POLICY "Read products" ON public.products FOR SELECT TO authenticated
USING (public.is_admin(auth.uid()) OR public.user_belongs_to_client(auth.uid(), client_id));
CREATE POLICY "Insert products" ON public.products FOR INSERT TO authenticated
WITH CHECK (public.is_admin(auth.uid()) OR public.user_belongs_to_client(auth.uid(), client_id));
CREATE POLICY "Update products" ON public.products FOR UPDATE TO authenticated
USING (public.is_admin(auth.uid()) OR public.user_belongs_to_client(auth.uid(), client_id))
WITH CHECK (public.is_admin(auth.uid()) OR public.user_belongs_to_client(auth.uid(), client_id));
CREATE POLICY "Delete products" ON public.products FOR DELETE TO authenticated
USING (public.is_admin(auth.uid()) OR public.user_belongs_to_client(auth.uid(), client_id));

-- =========================================================================
-- PRODUCT IMAGES
-- =========================================================================
CREATE TABLE public.product_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  alt_text TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_images TO authenticated;
GRANT ALL ON public.product_images TO service_role;
ALTER TABLE public.product_images ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_product_images_product ON public.product_images(product_id);

CREATE POLICY "Read product images" ON public.product_images FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.products p WHERE p.id = product_id AND (public.is_admin(auth.uid()) OR public.user_belongs_to_client(auth.uid(), p.client_id))));
CREATE POLICY "Write product images" ON public.product_images FOR INSERT TO authenticated
WITH CHECK (EXISTS (SELECT 1 FROM public.products p WHERE p.id = product_id AND (public.is_admin(auth.uid()) OR public.user_belongs_to_client(auth.uid(), p.client_id))));
CREATE POLICY "Update product images" ON public.product_images FOR UPDATE TO authenticated
USING (EXISTS (SELECT 1 FROM public.products p WHERE p.id = product_id AND (public.is_admin(auth.uid()) OR public.user_belongs_to_client(auth.uid(), p.client_id))))
WITH CHECK (EXISTS (SELECT 1 FROM public.products p WHERE p.id = product_id AND (public.is_admin(auth.uid()) OR public.user_belongs_to_client(auth.uid(), p.client_id))));
CREATE POLICY "Delete product images" ON public.product_images FOR DELETE TO authenticated
USING (EXISTS (SELECT 1 FROM public.products p WHERE p.id = product_id AND (public.is_admin(auth.uid()) OR public.user_belongs_to_client(auth.uid(), p.client_id))));

-- =========================================================================
-- STORE INTEGRATIONS (encrypted credentials)
-- =========================================================================
CREATE TABLE public.store_integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  platform public.store_platform NOT NULL,
  store_url TEXT NOT NULL,
  store_name TEXT,
  api_version TEXT,
  default_location_id TEXT,
  default_collection TEXT,
  default_category TEXT,
  -- ciphertext blobs (base64 JSON of {iv,ct,tag})
  enc_access_token TEXT,
  enc_consumer_key TEXT,
  enc_consumer_secret TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_tested_at TIMESTAMPTZ,
  last_test_status public.log_status,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (client_id, platform)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.store_integrations TO authenticated;
GRANT ALL ON public.store_integrations TO service_role;
ALTER TABLE public.store_integrations ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_integrations_updated BEFORE UPDATE ON public.store_integrations
FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Only admins read/write integrations from the client. Server fns use service role for publishing.
CREATE POLICY "Admins read integrations" ON public.store_integrations FOR SELECT TO authenticated
USING (public.is_admin(auth.uid()));
CREATE POLICY "Admins insert integrations" ON public.store_integrations FOR INSERT TO authenticated
WITH CHECK (public.is_admin(auth.uid()));
CREATE POLICY "Admins update integrations" ON public.store_integrations FOR UPDATE TO authenticated
USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
CREATE POLICY "Admins delete integrations" ON public.store_integrations FOR DELETE TO authenticated
USING (public.is_admin(auth.uid()));

-- =========================================================================
-- IMPORT LOGS
-- =========================================================================
CREATE TABLE public.import_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
  client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL,
  platform public.store_platform,
  action public.log_action NOT NULL,
  status public.log_status NOT NULL,
  request_payload JSONB,
  response_payload JSONB,
  error_message TEXT,
  actor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.import_logs TO authenticated;
GRANT ALL ON public.import_logs TO service_role;
ALTER TABLE public.import_logs ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_import_logs_client ON public.import_logs(client_id);
CREATE INDEX idx_import_logs_product ON public.import_logs(product_id);

CREATE POLICY "Read logs" ON public.import_logs FOR SELECT TO authenticated
USING (public.is_admin(auth.uid()) OR (client_id IS NOT NULL AND public.user_belongs_to_client(auth.uid(), client_id)));

-- =========================================================================
-- BOOTSTRAP: first user becomes super_admin; profile auto-created
-- =========================================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  is_first_user BOOLEAN;
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name'));

  SELECT NOT EXISTS(SELECT 1 FROM public.user_roles WHERE role = 'super_admin') INTO is_first_user;
  IF is_first_user THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'super_admin');
  ELSE
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'client');
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- =========================================================================
-- STORAGE POLICIES for product-images (private bucket)
-- =========================================================================
CREATE POLICY "Authenticated read product images"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'product-images');

CREATE POLICY "Authenticated insert product images"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'product-images');

CREATE POLICY "Authenticated update own product images"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'product-images' AND owner = auth.uid())
WITH CHECK (bucket_id = 'product-images');

CREATE POLICY "Authenticated delete own product images"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'product-images' AND (owner = auth.uid() OR public.is_admin(auth.uid())));
