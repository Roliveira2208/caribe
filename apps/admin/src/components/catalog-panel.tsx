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
import { AuthApiError, isTwoFactorRequired, type Locale } from "@caribe/shared";
import {
  archiveCatalogProduct,
  createCatalogProduct,
  listCatalogProducts,
  publishCatalogProduct,
  resolveCatalogPanelAccess,
  updateCatalogProduct,
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

  const current = pages[pageIndex];
  const rows = current?.items ?? [];
  const nextCursor = current?.nextCursor ?? null;
  const redirectTo = `/${locale}/admin/catalog`;

  const handleError = useCallback(
    (cause: unknown, listing = false) => {
      if (cause instanceof AuthApiError) {
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
    const title = values["title"] as { es: string; en?: string };
    const description = values["description"] as { es: string; en?: string };
    const common: CatalogProductInput = {
      roomType: String(values["roomType"]),
      title: { es: title.es, ...(title.en ? { en: title.en } : {}) },
      description: { es: description.es, ...(description.en ? { en: description.en } : {}) },
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
        if (!editable && !statusable) return <span>{t("noActions")}</span>;
        return (
          <Space wrap>
            {editable ? (
              <Button type="link" onClick={() => openEdit(product)}>
                {t("editProduct")}
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
            <Input id="catalog-providerId" disabled={modal?.mode === "edit"} />
          </Form.Item>
          <Form.Item name="hotelKey" label={t("hotelKey")}>
            <Input id="catalog-hotelKey" disabled={modal?.mode === "edit"} />
          </Form.Item>
          <Form.Item name="basePriceUsd" label={t("basePriceUsd")}>
            <Input id="catalog-basePriceUsd" inputMode="decimal" />
          </Form.Item>
          <Form.Item name={["title", "es"]} label={t("titleEs")}>
            <Input id="catalog-titleEs" />
          </Form.Item>
          <Form.Item name={["title", "en"]} label={t("titleEn")}>
            <Input id="catalog-titleEn" />
          </Form.Item>
          <Form.Item name={["description", "es"]} label={t("descriptionEs")}>
            <Input.TextArea id="catalog-descriptionEs" />
          </Form.Item>
          <Form.Item name={["description", "en"]} label={t("descriptionEn")}>
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
    </div>
  );
}
