"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
  Tabs,
  Tag,
  type TableColumnsType,
} from "antd";
import { AuthApiError, isTwoFactorRequired, type Locale } from "@caribe/shared";
import {
  changeMemberRole,
  inviteMember,
  isUsersOrganizationError,
  listMembers,
  listSessions,
  listTargetOrganizations,
  resolveTargetOrganization,
  revokeSession,
  type MemberItem,
  type OrganizationOption,
  type SessionItem,
  type UsersPanelAccess,
} from "@/lib/users-client";
import { deniedStatusOf } from "@/lib/denied-data";

interface UsersPanelProps {
  locale: Locale;
  access: UsersPanelAccess;
  agencyName?: string;
}

type Notice = { kind: "success" | "error"; message: string };

const ROLES = ["owner", "admin", "agent", "provider", "member"];

/** Panel del wireframe aprobado `panel-usuarios-roles.svg` (T-F2-21). */
export function UsersPanel({ locale, access, agencyName }: UsersPanelProps) {
  const t = useTranslations("users");
  const router = useRouter();
  const [inviteForm] = Form.useForm<Record<string, unknown>>();
  const [roleForm] = Form.useForm<Record<string, unknown>>();
  const [organizations, setOrganizations] = useState<OrganizationOption[]>([]);
  const [members, setMembers] = useState<MemberItem[]>([]);
  const [targetId, setTargetId] = useState("");
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState("ALL");
  const [tab, setTab] = useState("members");
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [roleMember, setRoleMember] = useState<MemberItem | null>(null);
  const [sessionUserId, setSessionUserId] = useState("");
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [revokeOpen, setRevokeOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);

  const platformOnly = access.scope === "platform";
  const redirectTo = `/${locale}/admin/users`;
  const roleOptions = ROLES.map((role) => ({ value: role, label: role }));
  const organizationOptions = organizations.map((organization) => ({
    value: organization.id,
    label: organization.name,
  }));

  const handleError = useCallback(
    (cause: unknown) => {
      if (cause instanceof AuthApiError) {
        if (isUsersOrganizationError(cause)) {
          setOrganizations([]);
          setMembers([]);
          setSessions([]);
          setNotice({ kind: "error", message: t("accessDenied") });
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
        const denied = deniedStatusOf(cause);
        if (denied !== null) {
          setOrganizations([]);
          setMembers([]);
          setSessions([]);
          setNotice({
            kind: "error",
            message: denied === "forbidden" ? t("forbidden") : t("notFound"),
          });
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
    let active = true;
    setLoading(true);
    listTargetOrganizations()
      .then((found) => {
        if (!active) return;
        setOrganizations(found);
        setTargetId((current) => {
          if (current !== "" && found.some((organization) => organization.id === current)) {
            return current;
          }
          const preferred = agencyName
            ? found.find((organization) => organization.name === agencyName)?.id
            : undefined;
          return preferred ?? found[0]?.id ?? "";
        });
      })
      .catch((cause: unknown) => {
        if (active) handleError(cause);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [agencyName, handleError, reload]);

  useEffect(() => {
    if (targetId === "") {
      setMembers([]);
      return;
    }
    let active = true;
    setLoading(true);
    listMembers(targetId)
      .then((found) => {
        if (active) setMembers(found);
      })
      .catch((cause: unknown) => {
        if (active) handleError(cause);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [targetId, reload, handleError]);

  useEffect(() => {
    inviteForm.setFieldsValue({ organizationId: targetId });
    roleForm.setFieldsValue({ organizationId: targetId });
  }, [targetId, inviteForm, roleForm]);

  const visibleMembers = useMemo(
    () =>
      members.filter((member) => {
        const text = `${member.name ?? ""} ${member.email ?? ""}`.toLocaleLowerCase(locale);
        const matchesQuery = text.includes(query.toLocaleLowerCase(locale));
        return matchesQuery && (roleFilter === "ALL" || member.role === roleFilter);
      }),
    [locale, members, query, roleFilter],
  );

  const selectedSession = sessions.find((session) => session.id === selectedSessionId) ?? null;

  function openInvite(): void {
    inviteForm.resetFields();
    inviteForm.setFieldsValue({ role: "member", organizationId: targetId });
    setNotice(null);
    setInviteOpen(true);
  }

  function openRole(member: MemberItem): void {
    roleForm.resetFields();
    roleForm.setFieldsValue({ role: member.role, organizationId: targetId });
    setNotice(null);
    setRoleMember(member);
  }

  async function submitInvite(): Promise<void> {
    const values = await inviteForm.validateFields();
    const organization = resolveTargetOrganization(
      organizations,
      String(values["organizationId"] ?? ""),
    );
    setBusy(true);
    try {
      await inviteMember({
        organizationId: organization.id,
        email: String(values["email"] ?? ""),
        role: String(values["role"] ?? ""),
      });
      setNotice({ kind: "success", message: t("inviteSent") });
      setInviteOpen(false);
      setReload((value) => value + 1);
    } catch (cause: unknown) {
      handleError(cause);
    } finally {
      setBusy(false);
    }
  }

  async function submitRole(): Promise<void> {
    if (!roleMember) return;
    const values = await roleForm.validateFields();
    const organization = resolveTargetOrganization(
      organizations,
      String(values["organizationId"] ?? ""),
    );
    setBusy(true);
    try {
      await changeMemberRole({
        organizationId: organization.id,
        memberId: roleMember.id,
        role: String(values["role"] ?? ""),
      });
      setNotice({ kind: "success", message: t("roleChanged") });
      setRoleMember(null);
      setReload((value) => value + 1);
    } catch (cause: unknown) {
      handleError(cause);
    } finally {
      setBusy(false);
    }
  }

  async function loadSessions(): Promise<void> {
    if (sessionUserId === "") {
      setNotice({ kind: "error", message: t("validationError") });
      return;
    }
    setBusy(true);
    try {
      setSessions(await listSessions(sessionUserId));
      setSelectedSessionId(null);
      setNotice(null);
    } catch (cause: unknown) {
      handleError(cause);
    } finally {
      setBusy(false);
    }
  }

  async function revokeSelected(): Promise<void> {
    if (!selectedSession?.token) {
      setNotice({ kind: "error", message: t("validationError") });
      return;
    }
    setBusy(true);
    try {
      await revokeSession(selectedSession.token);
      setNotice({ kind: "success", message: t("sessionRevoked") });
      setRevokeOpen(false);
      setSelectedSessionId(null);
      setSessions(await listSessions(sessionUserId));
    } catch (cause: unknown) {
      handleError(cause);
    } finally {
      setBusy(false);
    }
  }

  const memberColumns: TableColumnsType<MemberItem> = [
    {
      title: t("colMember"),
      key: "member",
      render: (_value, member) => <span>{member.name ?? member.email ?? t("ipHidden")}</span>,
    },
    { title: t("colRole"), dataIndex: "role" },
    {
      title: t("colTwoFactor"),
      key: "twoFactor",
      render: (_value, member) => (
        <Tag color={member.twoFactorEnabled === true ? "success" : "default"}>
          {member.twoFactorEnabled === true ? t("twoFactorOn") : t("twoFactorOff")}
        </Tag>
      ),
    },
    {
      title: t("colLastSession"),
      key: "lastSession",
      render: () => <span>{t("ipHidden")}</span>,
    },
    {
      title: t("colActions"),
      key: "actions",
      render: (_value, member) =>
        access.canChangeRole ? (
          <Button type="link" onClick={() => openRole(member)}>
            {t("changeRole")}
          </Button>
        ) : (
          <span>{t("noActions")}</span>
        ),
    },
  ];

  const sessionColumns: TableColumnsType<SessionItem> = [
    {
      title: t("colDevice"),
      dataIndex: "device",
      render: (value: string | null) => value ?? t("ipHidden"),
    },
    { title: t("colSessionStart"), dataIndex: "createdAt" },
    { title: t("colSessionEnd"), dataIndex: "expiresAt" },
    {
      title: t("colIp"),
      key: "ip",
      render: () => <span>{t("ipHidden")}</span>,
    },
  ];

  const agencyColumns: TableColumnsType<OrganizationOption> = [
    { title: t("targetOrg"), dataIndex: "name" },
    { title: t("colOrganizationId"), dataIndex: "id" },
  ];

  const tabs = [
    {
      key: "members",
      label: t("tabsMembers"),
      children: (
        <Space direction="vertical" style={{ width: "100%" }} size="middle">
          <Space wrap>
            <label htmlFor="users-search">{t("search")}</label>
            <Input
              id="users-search"
              allowClear
              placeholder={t("searchPlaceholder")}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <label htmlFor="users-role-filter">{t("role")}</label>
            <Select
              id="users-role-filter"
              style={{ width: 160 }}
              value={roleFilter}
              onChange={setRoleFilter}
              options={[
                { value: "ALL", label: t("allRoles") },
                ...roleOptions,
              ]}
            />
            <label htmlFor="users-target-org">{t("targetOrg")}</label>
            <Select
              id="users-target-org"
              style={{ minWidth: 220 }}
              value={targetId || undefined}
              onChange={setTargetId}
              options={organizationOptions}
            />
            {access.canInvite ? (
              <Button type="primary" onClick={openInvite}>
                {t("invite")}
              </Button>
            ) : null}
          </Space>
          <p style={{ margin: 0 }}>{t("twoFactorRequiredHint")}</p>
          <Table
            rowKey="id"
            columns={memberColumns}
            dataSource={visibleMembers}
            loading={loading}
            pagination={false}
            locale={{ emptyText: t("noMembers") }}
          />
        </Space>
      ),
    },
    ...(platformOnly
      ? [
          {
            key: "sessions",
            label: t("tabsSessions"),
            children: (
              <Space direction="vertical" style={{ width: "100%" }} size="middle">
                <Space wrap>
                  <label htmlFor="users-session-user">{t("sessionUserId")}</label>
                  <Input
                    id="users-session-user"
                    allowClear
                    placeholder={t("sessionUserIdPlaceholder")}
                    value={sessionUserId}
                    onChange={(event) => setSessionUserId(event.target.value)}
                  />
                  <Button loading={busy} onClick={loadSessions}>
                    {t("loadSessions")}
                  </Button>
                  {access.canRevokeSession ? (
                    <Button
                      danger
                      disabled={selectedSession === null}
                      onClick={() => setRevokeOpen(true)}
                    >
                      {t("revokeSelected")}
                    </Button>
                  ) : null}
                </Space>
                <Table
                  rowKey="id"
                  columns={sessionColumns}
                  dataSource={sessions}
                  loading={busy}
                  pagination={false}
                  locale={{ emptyText: t("noSessions") }}
                  rowSelection={{
                    type: "radio",
                    selectedRowKeys: selectedSessionId ? [selectedSessionId] : [],
                    onChange: (keys) => {
                      const first = keys[0];
                      setSelectedSessionId(typeof first === "string" ? first : null);
                    },
                  }}
                />
              </Space>
            ),
          },
          {
            key: "agencies",
            label: t("tabsAgencies"),
            children: (
              <Table
                rowKey="id"
                columns={agencyColumns}
                dataSource={organizations}
                loading={loading}
                pagination={false}
                locale={{ emptyText: t("noAgencies") }}
              />
            ),
          },
        ]
      : []),
  ];

  return (
    <div style={{ width: "100%" }}>
      <Card
        title={t("title")}
        extra={agencyName ? t("activeAgency", { agency: agencyName }) : null}
      >
        <p style={{ marginTop: 0 }}>{t("description")}</p>
        {notice ? <Alert type={notice.kind} showIcon message={notice.message} /> : null}
        <Tabs activeKey={tab} onChange={setTab} items={tabs} />
      </Card>
      <Modal
        open={inviteOpen}
        title={t("invite")}
        okText={t("save")}
        cancelText={t("cancel")}
        confirmLoading={busy}
        onCancel={() => setInviteOpen(false)}
        onOk={submitInvite}
      >
        <Form form={inviteForm} layout="vertical" requiredMark={false}>
          <Form.Item
            name="email"
            label={t("email")}
            rules={[{ required: true, type: "email" }]}
          >
            <Input id="users-invite-email" placeholder={t("emailPlaceholder")} />
          </Form.Item>
          <Form.Item name="role" label={t("role")}>
            <Select id="users-invite-role" options={roleOptions} />
          </Form.Item>
          <Form.Item name="organizationId" label={t("targetOrg")}>
            <Select id="users-invite-org" options={organizationOptions} />
          </Form.Item>
          <p style={{ margin: 0 }}>{t("targetOrgHint")}</p>
        </Form>
      </Modal>
      <Modal
        open={roleMember !== null}
        title={t("changeRole")}
        okText={t("confirmRole")}
        cancelText={t("cancel")}
        confirmLoading={busy}
        onCancel={() => setRoleMember(null)}
        onOk={submitRole}
      >
        <Form form={roleForm} layout="vertical" requiredMark={false}>
          <p style={{ marginTop: 0 }}>
            {roleMember?.name ?? roleMember?.email ?? t("ipHidden")}
          </p>
          <Space wrap>
            <span>{t("before")}</span>
            <Tag>{roleMember?.role}</Tag>
            <span>{t("after")}</span>
          </Space>
          <Form.Item name="role" label={t("role")}>
            <Select id="users-role-new" options={roleOptions} />
          </Form.Item>
          <Form.Item name="organizationId" label={t("targetOrg")}>
            <Select id="users-role-org" options={organizationOptions} />
          </Form.Item>
        </Form>
      </Modal>
      <Modal
        open={revokeOpen}
        title={t("revokeSelected")}
        okText={t("revokeSelected")}
        cancelText={t("cancel")}
        confirmLoading={busy}
        onCancel={() => setRevokeOpen(false)}
        onOk={revokeSelected}
      >
        <p style={{ marginTop: 0 }}>{selectedSession?.device ?? t("ipHidden")}</p>
        <p>{t("ipHidden")}</p>
      </Modal>
    </div>
  );
}
