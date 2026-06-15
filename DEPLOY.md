# Deploying whenTrain? on GCP (free tier)

This runs the whole stack on a single **Compute Engine `e2-micro`** VM via Docker
Compose. The `e2-micro` is in GCP's [Always Free](https://cloud.google.com/free/docs/free-cloud-features#compute)
tier (one per month in `us-west1`, `us-central1`, or `us-east1`), so the steady-state
cost is **~$0/mo** — only egress beyond the free 1 GB/mo is billable.

The stack is two containers:

- **backend** — Node/Express, caches GTFS-RT feed bytes in-process for 30 s (no Redis).
- **frontend** — Caddy serving the built PWA and reverse-proxying `/api` to the backend,
  with automatic HTTPS via Let's Encrypt.

> **RAM note:** `e2-micro` has 1 GB. The two containers fit, but headroom is thin.
> The swap step below is what keeps an occasional memory spike from OOM-killing a
> container. If you see OOM kills under load, resize to `e2-small` (2 GB, ~$13/mo) —
> no other change needed.

## 0. Create the project (one-time)

```bash
gcloud projects create whentrain-lushchik --name="whenTrain"
gcloud billing projects link whentrain-lushchik --billing-account=<BILLING_ACCOUNT_ID>
gcloud config set project whentrain-lushchik
gcloud services enable compute.googleapis.com
```

Billing must be linked even for the free tier — the e2-micro is only free while a
valid billing account is attached. List your billing accounts with
`gcloud billing accounts list`.

## 1. Create the VM

```bash
gcloud compute instances create whentrain \
  --machine-type=e2-micro \
  --zone=us-central1-a \
  --image-family=debian-12 --image-project=debian-cloud \
  --boot-disk-size=30GB --boot-disk-type=pd-standard \
  --tags=http-server,https-server
```

Allow web traffic (the `http-server`/`https-server` tags map to default firewall rules;
if your project lacks them, create them):

```bash
gcloud compute firewall-rules create allow-http  --allow=tcp:80  --target-tags=http-server  --direction=INGRESS 2>/dev/null || true
gcloud compute firewall-rules create allow-https --allow=tcp:443 --target-tags=https-server --direction=INGRESS 2>/dev/null || true
```

## 2. Point DNS at the VM

Get the external IP and create an **A record** for `whentrain.lushchik.com` → that IP:

```bash
gcloud compute instances describe whentrain --zone=us-central1-a \
  --format='get(networkInterfaces[0].accessConfigs[0].natIP)'
```

Caddy can only issue a certificate once DNS resolves to the VM, so do this before step 5.

## 3. Install Docker on the VM

```bash
gcloud compute ssh whentrain --zone=us-central1-a
# on the VM:
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"   # log out/in for this to take effect
```

## 4. Add swap (cheap OOM insurance for 1 GB RAM)

```bash
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

## 5. Deploy

```bash
git clone https://github.com/<you>/when-train.git && cd when-train
cp .env.example .env          # SITE_ADDRESS is already set to the domain
APP_VERSION=$(git rev-parse --short HEAD) docker compose up -d --build
```

`APP_VERSION` is the git short hash; it's baked into the frontend bundle and shown
next to the "last updated" time in the UI, so you can tell at a glance which build
is live. Omit it and the version reads `dev`.

Caddy fetches the certificate on first boot (a few seconds once DNS is live).
The backend downloads MTA GTFS static data on first start (~10 s) before `/health`
goes green.

## 6. Verify

```bash
curl -s https://whentrain.lushchik.com/health         # {"ok":true}
curl -sI https://whentrain.lushchik.com/ | head -1     # HTTP/2 200
```

## Operations

```bash
docker compose logs -f backend     # tail backend logs
git pull && APP_VERSION=$(git rev-parse --short HEAD) docker compose up -d --build   # redeploy
docker compose down                # stop (keeps the caddy_data cert volume)
```

Certificates persist in the `caddy_data` Docker volume, so restarts and redeploys
don't re-request them (which matters — Let's Encrypt rate-limits issuance).

## Cutover from the old host

Because Caddy provisions its own certificate, the only externally visible step is
the DNS A-record change. To avoid downtime: stand this VM up fully (steps 1–5) using
a temporary test hostname or the raw IP, confirm it serves, then repoint
`whentrain.lushchik.com` and let the old Coolify/DigitalOcean box drain.
