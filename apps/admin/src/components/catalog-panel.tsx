"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import {
  Alert,
  Button,
  Card,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  type TableColumnsType,
} from "antd";
import { AuthApiError, isTwoFactorRequired, todayInCaracas, type Locale } from "@caribe/shared";
import {
  archiveCatalogProduct,
  createCatalogProduct,
  listCatalogAvailability,
  listCatalogProducts,
  newAvailabilityNight,
  publishCatalogProduct,
  resolveCatalogPanelAccess,
  updateCatalogProduct,
  writeCatalogAvailability,
  type CatalogAvailabilityNight,
  type CatalogProduct,
  type CatalogProductInput,
  type CatalogProductPage,
  type CatalogProductStatus,
  type CatalogPanelAccess,
} from "@/lib/catalog-client";

interface CatalogPanelProps {
  locale: Locale;
  /** Matriz resuelta en servidor; el id del proveedor se completa con el listado. */
  access: CatalogPanelAccess;
  agencyName?: string;
}

type ModalMode = "create" | "edit";
type Notice = { kind: "success" | "error"; message: string };

const STATUS_ORDER: CatalogProductStatus[] = ["DRAFT", "PUBLISHED", "ARCHIVED"];
const PAGE_SIZE = 20;

function splitList(value: unknown): string[] {
  return typeof value === "string"
    ? value
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry) => entry !== "")
    : [];
}

/** Días calendario en UTC para el rango por defecto del editor de noches. */
function addDaysToDate(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

/** Panel de catálogo del wireframe aprobado `panel-catalogo.svg` (T-F2-18). */
export function CatalogPanel({ locale, access: baseAccess, agencyName }: CatalogPanelProps) {
  const t = useTranslations("catalog");
  const router = useRouter();
  const [form] = Form.useForm<Record<string, unknown>>();
  const [status, setStatus] = useState<CatalogProductStatus | "ALL">("ALL");
  const [query, setQuery] = useState("");
  const [pages, setPages] = useState<CatalogProductPage[]>([]);
  const [pageIndex, setPageIndex] = useState(0);
  const [viewerProviderId, setViewerProviderId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [modal, setModal] = useState<{ mode: ModalMode; product: CatalogProduct | null } | null>(
    null,
  );
  const [availabilityProduct, setAvailabilityProduct] = useState<CatalogProduct | null>(null);
  const [availabilityRange, setAvailabilityRange] = useState({ from: "", to: "" });
  const [availabilityNights, setAvailabilityNights] = useState<CatalogAvailabilityNight[]>([]);
  const [availabilityDraft, setAvailabilityDraft] = useState<
    Record<string, { capacity: string; priceUsd: string }>
  >({});
  const [newNightOpen, setNewNightOpen] = useState(false);
  const [newNight, setNewNight] = useState({ night: "", capacity: "", priceUsd: "" });
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const generation = useRef(0);

  const access = useMemo(
    () =>
      resolveCatalogPanelAccess({
        mode: baseAccess.mode,
        role: baseAccess.role,
        providerId: viewerProviderId,
      }),
    [baseAccess.mode, baseAccess.role, viewerProviderId],
  );

  const statusLabel = (value: CatalogProductStatus): string => {
    if (value === "DRAFT") return t("statusDraft");
    if (value === "PUBLISHED") return t("statusPublished");
    return t("statusArchived");
  };

  const draftFromNights = (nights: CatalogAvailabilityNight[]) =>
    Object.fromEntries(
      nights.map((night) => [
        night.night,
        { capacity: String(night.capacity), priceUsd: night.priceUsd },
      ]),
    );

  const current = pages[pageIndex];
  const rows = current?.items ?? [];
  const nextCursor = current?.nextCursor ?? null;
  const redirectTo = `/${locale}/admin/catalog`;

  const handleError = useCallback(
    (cause: unknown, listing = false) => {
      if (cause instanceof AuthApiError) {
        if (cause.code === "AVAILABILITY_DUPLICATED") {
          setNotice({ kind: "error", message: t("duplicatedNight") });
          return;
        }
        if (cause.status === 401) {
          router.replace(`/${locale}/login?redirectTo=${encodeURIComponent(redirectTo)}`);
          return;
        }
        if (isTwoFactorRequired(cause)) {
          router.replace(`/${locale}/two-factor?redirectTo=${encodeURIComponent(redirectTo)}`);
          return;
        }
        if (cause.status === 403) {
          setNotice({ kind: "error", message: listing ? t("readOnly") : t("forbidden") });
          return;
        }
        if (cause.status === 404) {
          setNotice({ kind: "error", message: t("notFound") });
          return;
        }
        if (cause.status === 422) {
          setNotice({ kind: "error", message: t("validationError") });
          return;
        }
      }
      setNotice({ kind: "error", message: t("genericError") });
    },
    [locale, redirectTo, router, t],
  );

  useEffect(() => {
    const token = ++generation.current;
    let active = true;
    setLoading(true);
    setNotice(null);
    setPages([]);
    setPageIndex(0);
    listCatalogProducts({ status, q: query, limit: PAGE_SIZE })
      .then((page) => {
        if (active && token === generation.current) {
          setPages([page]);
          setViewerProviderId(page.viewerProviderId);
        }
      })
      .catch((cause: unknown) => {
        if (active && token === generation.current) handleError(cause, true);
      })
      .finally(() => {
        if (active && token === generation.current) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [status, query, reload, handleError]);

  async function goNext(): Promise<void> {
    if (!nextCursor || loadingMore) return;
    const target = pageIndex + 1;
    if (pages[target]) {
      setPageIndex(target);
      return;
    }
    setLoadingMore(true);
    try {
      const page = await listCatalogProducts({
        status,
        q: query,
        limit: PAGE_SIZE,
        cursor: nextCursor,
      });
      setPages((previous) => [...previous, page]);
      setPageIndex(target);
    } catch (cause: unknown) {
      handleError(cause, true);
    } finally {
      setLoadingMore(false);
    }
  }

  function goPrevious(): void {
    if (pageIndex === 0) return;
    setPageIndex((value) => value - 1);
  }

  function openCreate(): void {
    form.resetFields();
    setModal({ mode: "create", product: null });
  }

  function openEdit(product: CatalogProduct): void {
    form.setFieldsValue({
      hotelKey: product.hotelKey,
      roomType: product.roomType,
      title: { es: product.title.es, en: product.title.en },
      description: { es: product.description.es, en: product.description.en },
      destinationId: product.destination.id,
      providerId: product.providerId,
      basePriceUsd: product.basePriceUsd,
      cancellationPolicyId: product.cancellationPolicyId ?? "",
      stars: product.attributes.stars,
      maxGuests: product.attributes.maxGuests,
      amenities: product.attributes.amenities.join(", "),
      images: product.attributes.images.join(", "),
    });
    setModal({ mode: "edit", product });
  }

  async function submit(): Promise<void> {
    if (!modal) return;
    const values = await form.validateFields();
    const title = values["title"] as { es: string; en: string };
    const description = values["description"] as { es: string; en: string };
    const common: CatalogProductInput = {
      roomType: String(values["roomType"]),
      title: { es: title.es, en: title.en },
      description: { es: description.es, en: description.en },
      destinationId: String(values["destinationId"]),
      basePriceUsd: String(values["basePriceUsd"]),
      attributes: {
        stars: Number(values["stars"]),
        maxGuests: Number(values["maxGuests"]),
        amenities: splitList(values["amenities"]),
        images: splitList(values["images"]),
      },
    };
    const policy = String(values["cancellationPolicyId"] ?? "");
    if (policy !== "") common.cancellationPolicyId = policy;

    setBusy(true);
    try {
      if (modal.mode === "create") {
        const hotelKey = String(values["hotelKey"] ?? "");
        const providerId = String(values["providerId"] ?? "");
        if (hotelKey !== "") common.hotelKey = hotelKey;
        if (providerId !== "") common.providerId = providerId;
        await createCatalogProduct(common);
        setNotice({ kind: "success", message: t("savedNotice") });
      } else if (modal.product) {
        if (policy === "") common.cancellationPolicyId = null;
        await updateCatalogProduct(modal.product.id, common);
        setNotice({ kind: "success", message: t("savedNotice") });
      }
      setModal(null);
      setReload((value) => value + 1);
    } catch (cause: unknown) {
      handleError(cause);
    } finally {
      setBusy(false);
    }
  }

  async function changeStatus(
    product: CatalogProduct,
    action: "publish" | "archive",
  ): Promise<void> {
    setBusy(true);
    try {
      if (action === "publish") {
        await publishCatalogProduct(product.id);
        setNotice({ kind: "success", message: t("publishedNotice") });
      } else {
        await archiveCatalogProduct(product.id);
        setNotice({ kind: "success", message: t("archivedNotice") });
      }
      setReload((value) => value + 1);
    } catch (cause: unknown) {
      handleError(cause);
    } finally {
      setBusy(false);
    }
  }

  function openAvailability(product: CatalogProduct): void {
    const from = todayInCaracas();
    const range = { from, to: addDaysToDate(from, 7) };
    setAvailabilityProduct(product);
    setAvailabilityRange(range);
    setAvailabilityNights([]);
    setAvailabilityDraft({});
    setNewNightOpen(false);
    setNewNight({ night: "", capacity: "", priceUsd: "" });
    void applyAvailability(product, range);
  }

  function addNewNight(): void {
    const created = newAvailabilityNight(newNight);
    if (!created) {
      setNotice({ kind: "error", message: t("validationError") });
      return;
    }
    if (availabilityNights.some((night) => night.night === created.night)) {
      setNotice({ kind: "error", message: t("duplicatedNight") });
      return;
    }
    setAvailabilityNights((previous) => [...previous, created]);
    setAvailabilityDraft((previous) => ({
      ...previous,
      [created.night]: {
        capacity: String(created.capacity),
        priceUsd: created.priceUsd,
      },
    }));
    setNewNight({ night: "", capacity: "", priceUsd: "" });
    setNewNightOpen(false);
    setNotice(null);
  }

  async function applyAvailability(
    product: CatalogProduct | null = availabilityProduct,
    range = availabilityRange,
  ): Promise<void> {
    if (!product || !range.from || !range.to || range.to <= range.from) {
      setNotice({ kind: "error", message: t("validationError") });
      return;
    }
    setBusy(true);
    try {
      const result = await listCatalogAvailability(product.id, range);
      setAvailabilityNights(result.nights);
      setAvailabilityDraft(draftFromNights(result.nights));
    } catch (cause: unknown) {
      handleError(cause);
    } finally {
      setBusy(false);
    }
  }

  async function saveAvailability(): Promise<void> {
    if (!availabilityProduct) return;
    const nights = availabilityNights.map((night) => ({
      night: night.night,
      capacity: Number(availabilityDraft[night.night]?.capacity ?? String(night.capacity)),
      priceUsd: availabilityDraft[night.night]?.priceUsd ?? night.priceUsd,
    }));
    if (nights.length === 0) {
      setNotice({ kind: "error", message: t("validationError") });
      return;
    }
    setBusy(true);
    try {
      const saved = await writeCatalogAvailability(availabilityProduct.id, nights);
      setAvailabilityNights(saved.nights);
      setAvailabilityDraft(draftFromNights(saved.nights));
      setNotice({ kind: "success", message: t("availabilitySaved") });
      setAvailabilityProduct(null);
      setReload((value) => value + 1);
    } catch (cause: unknown) {
      handleError(cause);
    } finally {
      setBusy(false);
    }
  }

  const availabilityColumns: TableColumnsType<CatalogAvailabilityNight> = [
    { title: t("colNight"), dataIndex: "night" },
    {
      title: t("colCapacity"),
      key: "capacity",
      render: (_value, night) => (
        <Input
          aria-label={`${t("colCapacity")} ${night.night}`}
          inputMode="numeric"
          value={availabilityDraft[night.night]?.capacity ?? String(night.capacity)}
          onChange={(event) =>
            setAvailabilityDraft((previous) => ({
              ...previous,
              [night.night]: {
                capacity: event.target.value,
                priceUsd: previous[night.night]?.priceUsd ?? night.priceUsd,
              },
            }))
          }
        />
      ),
    },
    { title: t("colReserved"), dataIndex: "reserved" },
    {
      title: t("colNightPrice"),
      key: "priceUsd",
      render: (_value, night) => (
        <Input
          aria-label={`${t("colNightPrice")} ${night.night}`}
          inputMode="decimal"
          value={availabilityDraft[night.night]?.priceUsd ?? night.priceUsd}
          onChange={(event) =>
            setAvailabilityDraft((previous) => ({
              ...previous,
              [night.night]: {
                capacity: previous[night.night]?.capacity ?? String(night.capacity),
                priceUsd: event.target.value,
              },
            }))
          }
        />
      ),
    },
  ];

  const columns: TableColumnsType<CatalogProduct> = [
    {
      title: t("colProduct"),
      render: (_value, product) => <span>{product.title[locale] ?? product.title.es}</span>,
    },
    { title: t("colRoomType"), dataIndex: "roomType" },
    { title: t("colProvider"), dataIndex: "providerId" },
    {
      title: t("colStatus"),
      dataIndex: "status",
      render: (value: CatalogProductStatus) => <Tag>{statusLabel(value)}</Tag>,
    },
    { title: t("colPrice"), dataIndex: "basePriceUsd" },
    {
      title: t("colActions"),
      render: (_value, product) => {
        const editable = access.canEdit(product);
        const statusable = access.canChangeStatus(product);
        const availability = access.canManageAvailability(product);
        if (!editable && !statusable && !availability) return <span>{t("noActions")}</span>;
        return (
          <Space wrap>
            {editable ? (
              <Button type="link" onClick={() => openEdit(product)}>
                {t("editProduct")}
              </Button>
            ) : null}
            {availability ? (
              <Button type="link" disabled={busy} onClick={() => openAvailability(product)}>
                {t("manageAvailability")}
              </Button>
            ) : null}
            {statusable && product.status !== "PUBLISHED" ? (
              <Button type="link" disabled={busy} onClick={() => changeStatus(product, "publish")}>
                {t("publish")}
              </Button>
            ) : null}
            {statusable && product.status !== "ARCHIVED" ? (
              <Button type="link" disabled={busy} onClick={() => changeStatus(product, "archive")}>
                {t("archive")}
              </Button>
            ) : null}
          </Space>
        );
      },
    },
  ];

  return (
    <div style={{ width: "100%" }}>
      {!access.canRead ? <Alert type="error" showIcon message={t("forbidden")} /> : null}
      <Card
        title={t("title")}
        extra={agencyName ? t("activeAgency", { agency: agencyName }) : null}
      >
        <p style={{ marginTop: 0 }}>{t("description")}</p>
        {notice ? <Alert type={notice.kind} showIcon message={notice.message} /> : null}
        <Space wrap style={{ marginBottom: 16 }}>
          <label htmlFor="catalog-q">{t("filterQ")}</label>
          <Input
            id="catalog-q"
            allowClear
            placeholder={t("filterQPlaceholder")}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <label htmlFor="catalog-status">{t("filterStatus")}</label>
          <Select
            id="catalog-status"
            style={{ width: 160 }}
            value={status}
            onChange={setStatus}
            options={[
              { value: "ALL", label: t("all") },
              ...STATUS_ORDER.map((value) => ({ value, label: statusLabel(value) })),
            ]}
          />
          {access.canCreate ? (
            <Button type="primary" onClick={openCreate}>
              {t("newProduct")}
            </Button>
          ) : null}
        </Space>
        {loading ? <p>{t("loading")}</p> : null}
        <Table
          rowKey="id"
          columns={columns}
          dataSource={rows}
          loading={loading}
          pagination={false}
          locale={{ emptyText: t("empty") }}
        />
        <Space wrap style={{ marginTop: 12 }}>
          <Button aria-label={t("previousPage")} disabled={pageIndex === 0} onClick={goPrevious}>
            {t("previousPage")}
          </Button>
          <span>{t("page", { current: pageIndex + 1 })}</span>
          <Button aria-label={t("nextPage")} disabled={!nextCursor || loadingMore} onClick={goNext}>
            {t("nextPage")}
          </Button>
        </Space>
      </Card>
      <Modal
        open={modal !== null}
        title={modal?.mode === "create" ? t("newProduct") : t("editProduct")}
        okText={t("save")}
        cancelText={t("cancel")}
        confirmLoading={busy}
        onCancel={() => setModal(null)}
        onOk={submit}
      >
        <Form form={form} layout="vertical" requiredMark={false}>
          <Form.Item name="roomType" label={t("roomType")}>
            <Input id="catalog-roomType" placeholder={t("roomTypePlaceholder")} />
          </Form.Item>
          <Form.Item name="destinationId" label={t("destinationId")}>
            <Input id="catalog-destinationId" />
          </Form.Item>
          <Form.Item name="providerId" label={t("providerId")}>
            <Input
              id="catalog-providerId"
              disabled={modal?.mode === "edit" || access.role === "provider"}
            />
          </Form.Item>
          <Form.Item name="hotelKey" label={t("hotelKey")}>
            <Input id="catalog-hotelKey" disabled={modal?.mode === "edit"} />
          </Form.Item>
          <Form.Item name="basePriceUsd" label={t("basePriceUsd")}>
            <Input id="catalog-basePriceUsd" inputMode="decimal" />
          </Form.Item>
          <Form.Item
            name={["title", "es"]}
            label={t("titleEs")}
            rules={[{ required: true, message: t("required") }]}
          >
            <Input id="catalog-titleEs" />
          </Form.Item>
          <Form.Item
            name={["title", "en"]}
            label={t("titleEn")}
            rules={[{ required: true, message: t("required") }]}
          >
            <Input id="catalog-titleEn" />
          </Form.Item>
          <Form.Item
            name={["description", "es"]}
            label={t("descriptionEs")}
            rules={[{ required: true, message: t("required") }]}
          >
            <Input.TextArea id="catalog-descriptionEs" />
          </Form.Item>
          <Form.Item
            name={["description", "en"]}
            label={t("descriptionEn")}
            rules={[{ required: true, message: t("required") }]}
          >
            <Input.TextArea id="catalog-descriptionEn" />
          </Form.Item>
          <Form.Item name="stars" label={t("stars")}>
            <Input id="catalog-stars" inputMode="numeric" />
          </Form.Item>
          <Form.Item name="maxGuests" label={t("maxGuests")}>
            <Input id="catalog-maxGuests" inputMode="numeric" />
          </Form.Item>
          <Form.Item name="amenities" label={t("amenities")}>
            <Input id="catalog-amenities" />
          </Form.Item>
          <Form.Item name="images" label={t("images")}>
            <Input id="catalog-images" />
          </Form.Item>
          <Form.Item name="cancellationPolicyId" label={t("cancellationPolicyId")}>
            <Input id="catalog-cancellationPolicyId" />
          </Form.Item>
        </Form>
      </Modal>
      <Modal
        open={availabilityProduct !== null}
        title={t("availabilityTitle")}
        okText={t("saveAvailability")}
        cancelText={t("cancel")}
        confirmLoading={busy}
        onCancel={() => setAvailabilityProduct(null)}
        onOk={() => void saveAvailability()}
      >
        <Space wrap style={{ marginBottom: 12 }}>
          <label htmlFor="catalog-availability-from">{t("from")}</label>
          <Input
            id="catalog-availability-from"
            type="date"
            value={availabilityRange.from}
            onChange={(event) =>
              setAvailabilityRange((previous) => ({ ...previous, from: event.target.value }))
            }
          />
          <label htmlFor="catalog-availability-to">{t("to")}</label>
          <Input
            id="catalog-availability-to"
            type="date"
            value={availabilityRange.to}
            onChange={(event) =>
              setAvailabilityRange((previous) => ({ ...previous, to: event.target.value }))
            }
          />
          <Button disabled={busy} onClick={() => void applyAvailability()}>
            {t("apply")}
          </Button>
        </Space>
        <Space wrap style={{ marginBottom: 12 }}>
          <Button disabled={busy} onClick={() => setNewNightOpen((previous) => !previous)}>
            {t("newNight")}
          </Button>
          {newNightOpen ? (
            <>
              <label htmlFor="catalog-new-night-night">{t("colNight")}</label>
              <Input
                id="catalog-new-night-night"
                type="date"
                value={newNight.night}
                onChange={(event) =>
                  setNewNight((previous) => ({ ...previous, night: event.target.value }))
                }
              />
              <label htmlFor="catalog-new-night-capacity">{t("colCapacity")}</label>
              <Input
                id="catalog-new-night-capacity"
                inputMode="numeric"
                value={newNight.capacity}
                onChange={(event) =>
                  setNewNight((previous) => ({ ...previous, capacity: event.target.value }))
                }
              />
              <label htmlFor="catalog-new-night-price">{t("colNightPrice")}</label>
              <Input
                id="catalog-new-night-price"
                inputMode="decimal"
                value={newNight.priceUsd}
                onChange={(event) =>
                  setNewNight((previous) => ({ ...previous, priceUsd: event.target.value }))
                }
              />
              <Button disabled={busy} onClick={addNewNight}>
                {t("addNight")}
              </Button>
            </>
          ) : null}
        </Space>
        <Table
          rowKey="night"
          columns={availabilityColumns}
          dataSource={availabilityNights}
          loading={busy}
          pagination={false}
          locale={{ emptyText: t("noNights") }}
        />
      </Modal>
    </div>
  );
}
