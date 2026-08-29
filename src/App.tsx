import {
  FormEvent,
  ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  Bell,
  Boxes,
  Camera,
  ChevronRight,
  CloudSun,
  Coins,
  Droplets,
  Eye,
  EyeOff,
  Gauge,
  Home,
  Landmark,
  Leaf,
  LockKeyhole,
  LogOut,
  Map,
  MapPin,
  Mail,
  Menu,
  PackageCheck,
  Plus,
  Search,
  Settings,
  ShoppingCart,
  Sprout,
  Store,
  Sun,
  Thermometer,
  WalletCards,
  Warehouse,
  Wind,
  X,
} from "lucide-react";
import { api } from "./api";
import type {
  Container,
  Dashboard,
  Farm,
  Holding,
  Order,
  RackView,
  Sensor,
  TokenRequest,
  User,
  Wallet,
} from "./model";
import { LiveMap } from "./components/LiveMap";
import { HlsVideo } from "./components/HlsVideo";
import { AdminOperations } from "./components/AdminOperations";
import { WalletLink } from "./components/WalletLink";
import { PublicMarketplace } from "./components/PublicMarketplace";

type Route = { page: string; id?: string };
const won = (value: number) => `${value.toLocaleString("ko-KR")}원`;
const date = (value: string) =>
  new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
const shortDate = (value: string) =>
  value
    ? new Intl.DateTimeFormat("ko-KR", {
        month: "long",
        day: "numeric",
      }).format(new Date(value))
    : "미정";
const requestKey = () =>
  globalThis.crypto?.randomUUID?.() ||
  `${Date.now()}-${Math.random().toString(16).slice(2)}`;
function useLoad<T>(path: string) {
  const [data, setData] = useState<T | null>(null),
    [error, setError] = useState("");
  const load = useCallback(() => {
    setError("");
    api<T>(path)
      .then(setData)
      .catch((e) => setError(e.message));
  }, [path]);
  useEffect(() => {
    load();
  }, [load]);
  return { data, error, reload: load };
}
function useLiveSensor(id: string, initial: Sensor | null) {
  const [sensor, setSensor] = useState<Sensor | null>(initial);
  useEffect(() => {
    setSensor(initial);
  }, [initial]);
  useEffect(() => {
    let source: EventSource | null = null;
    let closed = false;
    api<{ ticket: string }>(`/containers/${id}/live-ticket`, { method: "POST" })
      .then(({ ticket }) => {
        if (closed) return;
        source = new EventSource(
          `/api/containers/${id}/live?ticket=${encodeURIComponent(ticket)}`,
        );
        source.addEventListener("snapshot", (event) => {
          const value = JSON.parse((event as MessageEvent).data);
          if (value.payload?.sensor) setSensor(value.payload.sensor);
        });
        source.addEventListener("sensor", (event) => {
          const value = JSON.parse((event as MessageEvent).data);
          if (value.payload) setSensor(value.payload);
        });
      })
      .catch(() => undefined);
    return () => {
      closed = true;
      source?.close();
    };
  }, [id]);
  return sensor;
}

function Status({ value }: { value: string }) {
  const tone = value.includes("점검")
    ? "danger"
    : value.includes("대기")
      ? "warning"
      : "success";
  return (
    <span className={`status ${tone}`}>
      <i />
      {value}
    </span>
  );
}
function ContainerState({ value }: { value: string }) {
  const state = value.includes("생육")
    ? { label: "재배 중", tone: "growing" }
    : value.includes("대기")
      ? { label: "비어 있음", tone: "empty" }
      : { label: value === "점검중" ? "점검 중" : value, tone: "check" };
  return (
    <span className={`dashboard-token-state ${state.tone}`}>
      <i />
      {state.label}
    </span>
  );
}
function Empty({
  icon: Icon = Sprout,
  children,
}: {
  icon?: typeof Sprout;
  children: ReactNode;
}) {
  return (
    <div className="empty">
      <Icon />
      <strong>{children}</strong>
      <span>조건을 변경하거나 잠시 후 다시 확인해 주세요.</span>
    </div>
  );
}
function Loader() {
  return (
    <div className="loader">
      <span />
      <p>스마트팜 데이터를 불러오는 중</p>
    </div>
  );
}
function ErrorBox({ message }: { message: string }) {
  return message ? (
    <div className="error-box">
      <AlertTriangle />
      {message}
    </div>
  ) : null;
}
function Header({
  title,
  subtitle,
  back,
  action,
}: {
  title: string;
  subtitle?: string;
  back?: () => void;
  action?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div className="heading-row">
        {back && (
          <button className="icon-btn" onClick={back} aria-label="뒤로">
            <ArrowLeft />
          </button>
        )}
        <div>
          <p>{subtitle || "GREEN LINK"}</p>
          <h1>{title}</h1>
        </div>
      </div>
      {action}
    </header>
  );
}
function Login({ onLogin }: { onLogin: (user: User) => void }) {
  const [mode, setMode] = useState<"login" | "signup">("login"),
    [name, setName] = useState(""),
    [phone, setPhone] = useState(""),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [confirmPassword, setConfirmPassword] = useState(""),
    [showPassword, setShowPassword] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (mode === "signup" && password !== confirmPassword)
        throw new Error("비밀번호 확인이 일치하지 않습니다.");
      const result = await api<{ user: User; expiresAt: string }>(
        mode === "login" ? "/auth/login" : "/auth/signup",
        {
          method: "POST",
          body: JSON.stringify(
            mode === "login"
              ? { email, password }
              : { name, phone, email, password },
          ),
        },
      );
      onLogin(result.user);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="login-page">
      <section className="login-panel">
        <form onSubmit={submit}>
          <div className="mobile-logo">
            <Leaf /> GREEN LINK
          </div>
          <h1>{mode === "login" ? "로그인" : "회원가입"}</h1>
          <p className="login-guide">
            {mode === "login"
              ? "계정 정보를 입력해 주세요."
              : "일반 사용자 계정을 만들어 바로 시작하세요."}
          </p>
          <ErrorBox message={error} />
          {mode === "signup" && (
            <>
              <label>
                이름
                <span className="login-input">
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="이름을 입력하세요"
                    autoComplete="name"
                    maxLength={30}
                    required
                  />
                </span>
              </label>
              <label>
                연락처 (선택)
                <span className="login-input">
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="010-0000-0000"
                    autoComplete="tel"
                    maxLength={20}
                  />
                </span>
              </label>
            </>
          )}
          <label>
            이메일
            <span className="login-input">
              <Mail />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="이메일을 입력하세요"
                autoComplete="email"
                required
              />
            </span>
          </label>
          <label>
            비밀번호
            <span className="login-input">
              <LockKeyhole />
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="비밀번호를 입력하세요"
                autoComplete={
                  mode === "login" ? "current-password" : "new-password"
                }
                required
                minLength={mode === "signup" ? 8 : 1}
                maxLength={128}
              />
              <button
                type="button"
                className="password-toggle"
                onClick={() => setShowPassword((visible) => !visible)}
                aria-label={showPassword ? "비밀번호 숨기기" : "비밀번호 보기"}
              >
                {showPassword ? <EyeOff /> : <Eye />}
              </button>
            </span>
          </label>
          {mode === "signup" && (
            <label>
              비밀번호 확인
              <span className="login-input">
                <LockKeyhole />
                <input
                  type={showPassword ? "text" : "password"}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="비밀번호를 다시 입력하세요"
                  autoComplete="new-password"
                  required
                  minLength={8}
                  maxLength={128}
                />
              </span>
            </label>
          )}
          {mode === "signup" && (
            <p className="password-help">
              비밀번호는 8~128자로 입력할 수 있습니다.
            </p>
          )}
          <button className="primary-btn" disabled={busy}>
            {busy
              ? mode === "login"
                ? "로그인 중…"
                : "가입 중…"
              : mode === "login"
                ? "로그인"
                : "회원가입"}
          </button>
          <button
            type="button"
            className="auth-mode-button"
            onClick={() => {
              setMode((current) => (current === "login" ? "signup" : "login"));
              setPassword("");
              setConfirmPassword("");
              setError("");
            }}
          >
            {mode === "login"
              ? "계정이 없나요? 회원가입"
              : "이미 계정이 있나요? 로그인"}
          </button>
        </form>
      </section>
    </main>
  );
}

const nav = [
  { id: "dashboard", label: "대시보드", icon: Home },
  { id: "map", label: "농장 지도", icon: Map },
  { id: "myfarm", label: "내 농장", icon: Warehouse },
  { id: "market", label: "거래소", icon: Store },
  { id: "wallet", label: "내 지갑", icon: WalletCards },
];
function Shell({
  user,
  route,
  go,
  logout,
  children,
}: {
  user: User;
  route: Route;
  go: (page: string, id?: string) => void;
  logout: () => void;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const profileMenu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!profileOpen) return;

    function closeOnOutsideClick(event: MouseEvent) {
      if (!profileMenu.current?.contains(event.target as Node)) {
        setProfileOpen(false);
      }
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setProfileOpen(false);
    }

    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [profileOpen]);

  return (
    <div className="app">
      <aside className={open ? "open" : ""}>
        <div className="logo">
          <span>
            <Leaf />
          </span>
          <div>
            <strong>GREEN LINK</strong>
            <small>SMART FARM</small>
          </div>
        </div>
        <nav>
          {nav.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={route.page === id ? "active" : ""}
              onClick={() => {
                go(id);
                setOpen(false);
              }}
            >
              <Icon />
              {label}
            </button>
          ))}
          {user.role === "admin" && (
            <button
              className={route.page === "admin" ? "active" : ""}
              onClick={() => {
                go("admin");
                setOpen(false);
              }}
            >
              <Settings />
              관리자
            </button>
          )}
        </nav>
      </aside>
      {open && (
        <button
          className="scrim"
          onClick={() => setOpen(false)}
          aria-label="메뉴 닫기"
        />
      )}
      <div className="workspace">
        <div className="topbar">
          <button className="mobile-menu" onClick={() => setOpen(true)}>
            <Menu />
          </button>
          <div className="top-brand">
            <Leaf /> GREEN LINK
          </div>
          <div className="topbar-actions">
            <button
              className="top-icon"
              onClick={() => go("myfarm")}
              aria-label="환경 알림 확인"
              title="환경 알림 확인"
            >
              <Bell />
              <i />
            </button>
            <div className="profile-menu-wrap" ref={profileMenu}>
              <button
                className="profile-chip"
                onClick={() => setProfileOpen((visible) => !visible)}
                aria-haspopup="menu"
                aria-expanded={profileOpen}
                aria-label={`${user.name} 계정 메뉴`}
              >
                <span>{user.name[0]}</span>
                <b>{user.name}</b>
                <ChevronRight className="profile-chevron" />
              </button>
              {profileOpen && (
                <div className="profile-menu" role="menu">
                  <div className="profile-menu-user">
                    <span>{user.name[0]}</span>
                    <div>
                      <strong>{user.name}</strong>
                      <small>{user.email}</small>
                    </div>
                  </div>
                  <div className="profile-menu-role">
                    {user.role === "admin" ? "플랫폼 관리자" : "스마트팜 회원"}
                  </div>
                  <div className="profile-menu-divider" />
                  <button
                    role="menuitem"
                    onClick={() => {
                      go("profile");
                      setProfileOpen(false);
                    }}
                  >
                    <Settings />
                    프로필 설정
                  </button>
                  <button
                    className="profile-menu-logout"
                    role="menuitem"
                    onClick={() => {
                      setProfileOpen(false);
                      logout();
                    }}
                  >
                    <LogOut />
                    로그아웃
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
        <main className="content-area">{children}</main>
        <nav className="bottom-nav">
          {nav.slice(0, 5).map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={route.page === id ? "active" : ""}
              onClick={() => go(id)}
            >
              <Icon />
              <span>{label}</span>
            </button>
          ))}
        </nav>
      </div>
    </div>
  );
}

function DashboardPage({
  go,
  notify,
}: {
  go: (p: string, id?: string) => void;
  notify: (message: string) => void;
}) {
  const { data, error, reload } = useLoad<Dashboard>("/dashboard");
  async function cancelOrder(id: string) {
    if (!window.confirm("이 판매 주문을 취소하시겠습니까?")) return;
    try {
      await api(`/orders/${id}/cancel`, { method: "POST" });
      notify("판매 주문을 취소했습니다.");
      reload();
    } catch (err) {
      notify((err as Error).message);
    }
  }
  if (!data)
    return (
      <>
        <Header title="대시보드" subtitle="ASSET OVERVIEW" />
        <ErrorBox message={error} />
        {!error && <Loader />}
      </>
    );
  return (
    <>
      <Header
        title="대시보드"
        subtitle="ASSET OVERVIEW"
        action={
          <button
            className="outline-btn header-map-action"
            aria-label="거래소 보기"
            onClick={() => go("market")}
          >
            <Store />
            <span>거래소</span>
          </button>
        }
      />
      <section className="dashboard-balance-grid">
        <article>
          <span className="dashboard-balance-icon account">
            <Landmark />
          </span>
          <p>연결 계좌</p>
          <h2>
            {data.wallet.linkedAccount
              ? won(data.wallet.linkedAccount.balance)
              : "0원"}
          </h2>
          <small>
            {data.wallet.linkedAccount?.bankName || "연결된 계좌 없음"}
          </small>
        </article>
        <button onClick={() => go("wallet")}>
          <span className="dashboard-balance-icon wallet">
            <WalletCards />
          </span>
          <p>내 지갑</p>
          <h2>{won(data.wallet.mockCreditBalance)}</h2>
          <small>보유 토큰 {data.wallet.totalTokens.toLocaleString()}개</small>
        </button>
      </section>

      <section className="dashboard-group">
        <header className="dashboard-group-title">
          <h2>보유 토큰</h2>
          <button onClick={() => go("wallet")}>전체 보기</button>
        </header>
        {data.wallet.holdings.length ? (
          <div className="dashboard-token-list">
            {data.wallet.holdings.slice(0, 3).map((holding) => (
              <button
                key={holding.id}
                onClick={() => go("container", holding.containerId)}
              >
                <span className="dashboard-list-icon farm-token">
                  <Leaf />
                </span>
                <span className="dashboard-list-copy">
                  <strong>{holding.container.name}</strong>
                  <small>
                    {holding.tokenId} · {holding.container.cropName}
                  </small>
                  <ContainerState value={holding.container.status} />
                </span>
                <b>보유 {holding.quantity.toLocaleString()}개</b>
                <ChevronRight />
              </button>
            ))}
          </div>
        ) : (
          <p className="dashboard-empty">보유 중인 토큰이 없습니다.</p>
        )}
      </section>

      <section className="dashboard-group">
        <header className="dashboard-group-title">
          <h2>진행 중인 주문</h2>
          <button onClick={() => go("wallet")}>
            {data.wallet.openOrderCount.toLocaleString()}건
          </button>
        </header>
        {data.wallet.openOrders.length ? (
          <div className="dashboard-order-list">
            {data.wallet.openOrders.map((order) => (
              <article key={order.id}>
                <span className="dashboard-list-icon order">
                  <Store />
                </span>
                <span className="dashboard-list-copy">
                  <strong>{order.tokenId} 판매</strong>
                  <small>
                    개당 {won(order.unitPrice)} · {order.quantity}개 남음
                  </small>
                </span>
                <button onClick={() => cancelOrder(order.id)}>취소</button>
              </article>
            ))}
          </div>
        ) : (
          <p className="dashboard-empty">진행 중인 판매 주문이 없습니다.</p>
        )}
      </section>

      <section className="dashboard-group">
        <header className="dashboard-group-title">
          <h2>최근 거래</h2>
          <button onClick={() => go("wallet")}>전체 보기</button>
        </header>
        {data.wallet.recentTransactions.length ? (
          <div className="dashboard-transaction-list">
            {data.wallet.recentTransactions.map((transaction) => (
              <div key={transaction.id}>
                <span className="dashboard-list-icon transaction">
                  <ShoppingCart />
                </span>
                <span className="dashboard-list-copy">
                  <strong>
                    {transaction.tokenId} {transaction.type}
                  </strong>
                  <small>{date(transaction.createdAt)}</small>
                </span>
                <b>{transaction.quantity.toLocaleString()}개</b>
              </div>
            ))}
          </div>
        ) : (
          <p className="dashboard-empty">아직 거래 내역이 없습니다.</p>
        )}
      </section>

      <section className="dashboard-group">
        <header className="dashboard-group-title">
          <h2>내 농장</h2>
          <button onClick={() => go("myfarm")}>전체 보기</button>
        </header>
        <div className="dashboard-farm-list">
          <button onClick={() => go("myfarm")}>
            <span className="dashboard-list-icon farm">
              <Warehouse />
            </span>
            <span className="dashboard-list-copy">
              <strong>농장 운영 현황</strong>
              <small>
                농장 {data.farmCount}개 · 컨테이너 {data.containerCount}동
              </small>
            </span>
            <ChevronRight />
          </button>
          {data.alerts.length > 0 && (
            <button onClick={() => go("myfarm")}>
              <span className="dashboard-list-icon alert">
                <AlertTriangle />
              </span>
              <span className="dashboard-list-copy">
                <strong>확인이 필요한 항목</strong>
                <small>운영 알림 {data.alerts.length}건</small>
              </span>
              <ChevronRight />
            </button>
          )}
        </div>
      </section>
    </>
  );
}

function ContainerRow({
  item,
  onClick,
}: {
  item: Container;
  onClick: () => void;
}) {
  return (
    <button className="container-row" onClick={onClick}>
      <div className="crop-thumb">
        <Sprout />
      </div>
      <div className="row-main">
        <div>
          <strong>{item.name}</strong>
          <span>{item.cropName}</span>
        </div>
        <Status value={item.status} />
      </div>
      <div className="row-token">
        <small>{item.tokenId}</small>
        <strong>{won(item.tokenPrice)}</strong>
      </div>
      <ChevronRight />
    </button>
  );
}

function MapPage({ go }: { go: (p: string, id?: string) => void }) {
  const [query, setQuery] = useState(""),
    [status, setStatus] = useState("전체"),
    [selected, setSelected] = useState<Farm | null>(null);
  const { data: farms, error } = useLoad<Farm[]>(
    `/farms?q=${encodeURIComponent(query)}&status=${encodeURIComponent(status)}`,
  );
  useEffect(() => {
    if (farms?.length)
      setSelected((current) =>
        current && farms.some((farm) => farm.id === current.id)
          ? current
          : farms[0],
      );
  }, [farms]);
  return (
    <>
      <Header title="농장 지도" subtitle="OPENSTREETMAP · LAT/LNG" />
      <div className="map-page">
        <div className="map-controls">
          <label>
            <Search />
            <input
              placeholder="농장명 또는 지역 검색"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <div>
            {["전체", "운영중", "점검중"].map((s) => (
              <button
                key={s}
                className={status === s ? "active" : ""}
                onClick={() => setStatus(s)}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
        <div className="map-surface">
          {farms && <LiveMap farms={farms} onSelect={setSelected} />}
          {selected && (
            <article className="map-popup">
              <button className="close" onClick={() => setSelected(null)}>
                <X />
              </button>
              <p>SMART FARM</p>
              <div className="popup-title">
                <div>
                  <h2>{selected.name}</h2>
                  <span>
                    <MapPin />
                    {selected.address}
                  </span>
                </div>
                <Status value={selected.status} />
              </div>
              <p className="popup-copy">{selected.description}</p>
              <button
                className="primary-btn"
                onClick={() => go("farm", selected.id)}
              >
                농장 상세 보기 <ChevronRight />
              </button>
            </article>
          )}
        </div>
        <ErrorBox message={error} />
      </div>
    </>
  );
}

function MyFarmPage({ go }: { go: (p: string, id?: string) => void }) {
  const [query, setQuery] = useState("");
  const { data, error } = useLoad<Container[]>(
    `/containers?q=${encodeURIComponent(query)}`,
  );
  const farmCount = new Set(data?.map((item) => item.farmId)).size;
  const healthyRate = data?.length
    ? Math.round(
        (data.filter((item) => !item.status.includes("점검")).length /
          data.length) *
          100,
      )
    : 0;
  return (
    <>
      <Header
        title="내 농장"
        subtitle="CONTAINER MANAGEMENT"
        action={
          <label className="header-search">
            <Search />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="컨테이너 검색"
            />
          </label>
        }
      />
      <ErrorBox message={error} />
      <div className="farm-summary">
        <div>
          <Warehouse />
          <span>
            연결된 농장<strong>{farmCount}개소</strong>
          </span>
        </div>
        <div>
          <Boxes />
          <span>
            전체 컨테이너<strong>{data?.length || 0}동</strong>
          </span>
        </div>
        <div>
          <Activity />
          <span>
            정상 가동률<strong>{healthyRate}%</strong>
          </span>
        </div>
      </div>
      <div className="card-grid">
        {data?.map((c) => (
          <article
            className="farm-card"
            key={c.id}
            onClick={() => go("container", c.id)}
          >
            <div className="farm-visual">
              <Sprout />
              <Status value={c.status} />
              <span>{c.cropName}</span>
            </div>
            <div className="farm-card-body">
              <small>{c.farm?.name}</small>
              <h2>{c.name}</h2>
              <p>{c.description}</p>
              <div>
                <span>
                  예상 수확일<b>{c.harvestAt || "미정"}</b>
                </span>
                <span>
                  토큰 가격<b>{won(c.tokenPrice)}</b>
                </span>
              </div>
              <button>
                <span>환경 데이터 확인</span>
                <ChevronRight aria-hidden="true" />
              </button>
            </div>
          </article>
        ))}
      </div>
      {data?.length === 0 && <Empty>검색 결과가 없습니다.</Empty>}
    </>
  );
}

function FarmDetail({
  id,
  go,
}: {
  id: string;
  go: (p: string, id?: string) => void;
}) {
  const { data, error } = useLoad<Farm>(`/farms/${id}`);
  if (!data)
    return (
      <>
        <Header title="농장 상세" back={() => go("map")} />
        <ErrorBox message={error} />
        {!error && <Loader />}
      </>
    );
  return (
    <>
      <Header title={data.name} subtitle="FARM DETAIL" back={() => go("map")} />
      <section className="detail-banner">
        <div>
          <Status value={data.status} />
          <h2>{data.name}</h2>
          <p>
            <MapPin />
            {data.address}
          </p>
          <span>{data.description}</span>
        </div>
        <Warehouse />
      </section>
      <div className="detail-facts">
        <span>
          운영 상태<strong>{data.status}</strong>
        </span>
        <span>
          컨테이너<strong>{data.containers?.length || 0}동</strong>
        </span>
        <span>
          재배 작물
          <strong>
            {new Set(data.containers?.map((c) => c.cropName)).size}종
          </strong>
        </span>
      </div>
      <div className="section-title">
        <div>
          <p>CONTAINERS</p>
          <h2>컨테이너 목록</h2>
        </div>
      </div>
      <div className="container-list card-list">
        {data.containers?.map((c) => (
          <ContainerRow
            key={c.id}
            item={c}
            onClick={() => go("container", c.id)}
          />
        ))}
      </div>
    </>
  );
}

function SensorTile({
  icon: Icon,
  label,
  value,
  unit,
  ok = true,
}: {
  icon: typeof Thermometer;
  label: string;
  value: number;
  unit: string;
  ok?: boolean;
}) {
  return (
    <article className={`sensor-tile ${ok ? "" : "warn"}`}>
      <div>
        <Icon />
        <span>{label}</span>
      </div>
      <strong>
        {value.toLocaleString()}
        <small>{unit}</small>
      </strong>
      <p>{ok ? "적정 범위" : "확인 필요"}</p>
    </article>
  );
}

const defaultRackViews: RackView[] = [
  { id: "rack-a", label: "재배 랙 A", detail: "좌측 상단 베드" },
  { id: "rack-b", label: "재배 랙 B", detail: "우측 상단 베드" },
  { id: "rack-c", label: "재배 랙 C", detail: "좌측 하단 베드" },
  { id: "rack-d", label: "재배 랙 D", detail: "우측 하단 베드" },
];

function EnvironmentControl({
  containerId,
  sensor,
}: {
  containerId: string;
  sensor: Sensor | null;
}) {
  const [temperature, setTemperature] = useState("24.0");
  const [humidity, setHumidity] = useState("65.0");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const initialized = useRef(false);

  useEffect(() => {
    if (!sensor || initialized.current) return;
    setTemperature(sensor.temperature.toFixed(1));
    setHumidity(sensor.humidity.toFixed(1));
    initialized.current = true;
  }, [sensor]);

  async function applyClimate() {
    setBusy(true);
    setMessage("");
    try {
      await api(`/containers/${containerId}/climate/commands`, {
        method: "POST",
        body: JSON.stringify({
          targetTemperature: Number(temperature),
          targetHumidity: Number(humidity),
          mode: "auto",
          fan: true,
        }),
      });
      setMessage("온·습도 자동 제어를 요청했습니다.");
    } catch (err) {
      setMessage((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rack-environment-control">
      <div className="environment-control-title">
        <div>
          <strong>컨테이너 환경 제어</strong>
          <small>모든 랙에 공통 적용 · 자동 모드</small>
        </div>
        <span>전체 구역</span>
      </div>
      <div className="environment-control-grid">
        <div className="climate-setting">
          <span>
            <Thermometer /> 목표 온도
          </span>
          <div>
            <label className="climate-number-input">
              <input
                type="number"
                min="5"
                max="45"
                step="0.1"
                value={temperature}
                onChange={(event) => setTemperature(event.target.value)}
                aria-label="목표 온도 직접 입력"
              />
              <span>°C</span>
            </label>
          </div>
        </div>
        <div className="climate-setting humidity">
          <span>
            <Droplets /> 목표 습도
          </span>
          <div>
            <label className="climate-number-input">
              <input
                type="number"
                min="30"
                max="95"
                step="0.1"
                value={humidity}
                onChange={(event) => setHumidity(event.target.value)}
                aria-label="목표 습도 직접 입력"
              />
              <span>%</span>
            </label>
          </div>
        </div>
        <button
          className="primary-btn environment-apply"
          onClick={applyClimate}
          disabled={busy}
        >
          {busy ? "적용 중…" : "적용"}
        </button>
      </div>
      {message && (
        <p className="environment-control-message" aria-live="polite">
          {message}
        </p>
      )}
    </div>
  );
}

function RackCameraMap({
  selected,
  select,
  containerId,
  sensor,
  rackViews,
}: {
  selected: RackView | null;
  select: (rack: RackView) => void;
  containerId: string;
  sensor: Sensor | null;
  rackViews: RackView[];
}) {
  return (
    <section className="camera-layout-card">
      <header>
        <div>
          <p className="eyebrow">RACK CAMERA MAP</p>
          <h2>컨테이너 내부 모형도</h2>
        </div>
        <span>
          <i /> {selected ? selected.label : "랙 선택"}
        </span>
      </header>
      <p className="camera-layout-guide">
        확인할 재배 랙을 누르면 해당 구역의 카메라 화면이 표시됩니다.
      </p>
      <div className="camera-schematic">
        <span className="schematic-door">출입구</span>
        <div className="rack-grid">
          {rackViews.map((rack) => (
            <button
              key={rack.id}
              className={selected?.id === rack.id ? "active" : ""}
              onClick={() => select(rack)}
            >
              <span>
                <Sprout />
              </span>
              <strong>{rack.label}</strong>
              <small>{rack.detail}</small>
              <Camera />
            </button>
          ))}
        </div>
        <div className="rack-aisle">
          <span>중앙 통로</span>
        </div>
        <span className="schematic-utility">관수·공조 설비</span>
      </div>
      <EnvironmentControl containerId={containerId} sensor={sensor} />
    </section>
  );
}

function ContainerDetail({
  id,
  go,
  user,
  notify,
}: {
  id: string;
  go: (p: string, id?: string) => void;
  user: User;
  notify: (m: string) => void;
}) {
  const { data: item, error, reload } = useLoad<Container>(`/containers/${id}`);
  const { data: initialSensor } = useLoad<Sensor>(`/containers/${id}/sensors`);
  const { data: camera } = useLoad<{ hlsUrl: string | null; status: string }>(
    `/containers/${id}/camera`,
  );
  const [selectedRack, setSelectedRack] = useState<RackView | null>(null);
  const [issueOpen, setIssueOpen] = useState(false);
  const [issueSupply, setIssueSupply] = useState(10);
  const [issuePrice, setIssuePrice] = useState(100000);
  const [issueTerms, setIssueTerms] = useState("");
  const [issueBusy, setIssueBusy] = useState(false);
  const sensor = useLiveSensor(id, initialSensor);
  const ownerView = item?.farm?.ownerId === user.id;
  const canRequestIssue = Boolean(
    item &&
      ownerView &&
      item.totalTokenSupply === 0 &&
      item.tokenStatus !== "requested",
  );
  const pendingIssue = Boolean(
    item && ownerView && item.tokenStatus === "requested",
  );
  async function submitIssue(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIssueBusy(true);
    try {
      await api(`/containers/${id}/token-requests`, {
        method: "POST",
        body: JSON.stringify({
          supply: issueSupply,
          price: issuePrice,
          terms: { farmerMemo: issueTerms },
        }),
      });
      notify("토큰 발행 신청을 보냈습니다.");
      setIssueOpen(false);
      reload();
    } catch (err) {
      notify((err as Error).message);
    } finally {
      setIssueBusy(false);
    }
  }
  if (!item)
    return (
      <>
        <Header title="컨테이너 상세" back={() => go("myfarm")} />
        <ErrorBox message={error} />
        {!error && <Loader />}
      </>
    );
  return (
    <>
      <Header
        title={item.name}
        subtitle={item.tokenId}
        back={() => go("myfarm")}
        action={<Status value={item.status} />}
      />
      <section className="container-hero">
        <div className="live-frame">
          {selectedRack ? (
            <>
              <img
                className="rack-camera-placeholder"
                src="/images/smartfarm-cctv-placeholder.png"
                alt={`${selectedRack.label} 카메라 임시 화면`}
                decoding="async"
              />
              <span className="live-badge rack-view-badge">
                <i /> {selectedRack.label.toUpperCase()}
              </span>
            </>
          ) : camera?.hlsUrl ? (
            <HlsVideo src={camera.hlsUrl} />
          ) : (
            <>
              <span className="live-badge">
                <i /> CAMERA READY
              </span>
              <Sprout />
              <p>아래 모형도에서 확인할 랙을 선택하세요.</p>
            </>
          )}
        </div>
        <div>
          <p className="eyebrow">CROP INFORMATION</p>
          <h2>{item.cropName}</h2>
          <p>{item.description}</p>
          <div className="crop-dates">
            <span>
              파종일<strong>{item.plantedAt || "예정"}</strong>
            </span>
            <ChevronRight />
            <span>
              예상 수확일<strong>{item.harvestAt || "미정"}</strong>
            </span>
          </div>
          <div className="token-strip">
            <Coins />
            <span>
              컨테이너 토큰<b>{item.tokenId}</b>
            </span>
            <span>
              초기 참고가<b>{won(item.initialTokenPrice ?? item.tokenPrice)}</b>
            </span>
            <span>
              공개 매도
              <b>
                {item.marketAvailableQuantity ?? item.availableTokenQuantity}개
              </b>
            </span>
            <span>
              최근 체결가
              <b>
                {item.lastExecutionPrice
                  ? won(item.lastExecutionPrice)
                  : "없음"}
              </b>
            </span>
            <button onClick={() => go("market")}>거래소 보기</button>
          </div>
          {(canRequestIssue || pendingIssue) && (
            <div className="owner-issue-bar">
              <span>
                {pendingIssue
                  ? "농장주 발행 신청이 관리자 승인을 기다리고 있습니다."
                  : "이 컨테이너는 아직 토큰이 발행되지 않았습니다."}
              </span>
              {canRequestIssue && (
                <button
                  onClick={() => {
                    setIssueSupply(10);
                    setIssuePrice(item.initialTokenPrice ?? item.tokenPrice);
                    setIssueOpen(true);
                  }}
                >
                  <Plus />
                  발행 신청
                </button>
              )}
            </div>
          )}
        </div>
      </section>
      <RackCameraMap
        selected={selectedRack}
        select={setSelectedRack}
        containerId={id}
        sensor={sensor}
        rackViews={item.rackViews || defaultRackViews}
      />
      {sensor && (
        <>
          <div className="section-title">
            <div>
              <p>LIVE ENVIRONMENT</p>
              <h2>실시간 생육 환경</h2>
            </div>
            <span className="updated">
              <i />
              {date(sensor.updatedAt)} 갱신
            </span>
          </div>
          <div className="sensor-grid">
            <SensorTile
              icon={Thermometer}
              label="온도"
              value={sensor.temperature}
              unit="°C"
              ok={sensor.temperature <= 27}
            />
            <SensorTile
              icon={CloudSun}
              label="습도"
              value={sensor.humidity}
              unit="%"
            />
            <SensorTile
              icon={Sun}
              label="조도"
              value={sensor.light}
              unit="lx"
            />
            <SensorTile icon={Wind} label="CO₂" value={sensor.co2} unit="ppm" />
            <SensorTile
              icon={Droplets}
              label="배지 수분"
              value={sensor.soilMoisture}
              unit="%"
              ok={sensor.soilMoisture >= 45}
            />
            <SensorTile icon={Gauge} label="pH" value={sensor.ph} unit="" />
          </div>
          <section className="chart-card">
            <div>
              <p className="eyebrow">24H TEMPERATURE</p>
              <h3>온도 변화</h3>
            </div>
            <div className="chart-bars">
              {sensor.history.map((v, i) => (
                <span key={i} style={{ height: `${(v - 18) * 7 + 20}%` }}>
                  <i>{v}°</i>
                </span>
              ))}
            </div>
          </section>
        </>
      )}
      {issueOpen && (
        <Modal title="토큰 발행 신청" close={() => setIssueOpen(false)}>
          <form className="modal-form" onSubmit={submitIssue}>
            <div className="purchase-info">
              <span>{item.tokenId}</span>
              <h3>{item.name}</h3>
              <p>최초 발행량은 농장주 지갑에 먼저 기록됩니다.</p>
            </div>
            <div className="form-row">
              <label className="field">
                발행량
                <input
                  type="number"
                  min={1}
                  value={issueSupply}
                  onChange={(event) =>
                    setIssueSupply(Number(event.target.value))
                  }
                  required
                />
              </label>
              <label className="field">
                초기 참고 가격
                <input
                  type="number"
                  min={1000}
                  step={1000}
                  value={issuePrice}
                  onChange={(event) =>
                    setIssuePrice(Number(event.target.value))
                  }
                  required
                />
              </label>
            </div>
            <label className="field">
              발행 조건 메모
              <textarea
                rows={3}
                value={issueTerms}
                onChange={(event) => setIssueTerms(event.target.value)}
              />
            </label>
            <p className="asset-note">
              토큰은 농장 소유권, 증권, 배당권 또는 수익 보장을 의미하지
              않습니다.
            </p>
            <button className="primary-btn" disabled={issueBusy}>
              {issueBusy ? "신청 중…" : "발행 신청 보내기"}
            </button>
          </form>
        </Modal>
      )}
    </>
  );
}

function MarketPage({ notify }: { notify: (m: string) => void }) {
  const [query, setQuery] = useState(""),
    [buy, setBuy] = useState<Order | null>(null),
    [quantity, setQuantity] = useState(1),
    [buying, setBuying] = useState(false);
  const { data, error, reload } = useLoad<Order[]>(
    `/orders?q=${encodeURIComponent(query)}`,
  );
  async function purchase() {
    if (!buy) return;
    setBuying(true);
    try {
      await api(`/orders/${buy.id}/purchase`, {
        method: "POST",
        body: JSON.stringify({ quantity, idempotencyKey: requestKey() }),
      });
      notify(`${buy.tokenId} 토큰 ${quantity}개를 구매했습니다.`);
      setBuy(null);
      reload();
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBuying(false);
    }
  }
  return (
    <>
      <Header
        title="거래소"
        subtitle="SMART FARM EXCHANGE"
        action={
          <label className="header-search">
            <Search />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="토큰·판매자 검색"
            />
          </label>
        }
      />
      <div className="market-hero">
        <div>
          <Coins />
          <span>내부 모의 거래소</span>
          <h2>
            스마트팜 참여 토큰을
            <br />
            투명하게 거래하세요.
          </h2>
        </div>
        <div>
          <span>
            판매 주문<strong>{data?.length || 0}건</strong>
          </span>
          <span>
            결제 방식<strong>모의 크레딧</strong>
          </span>
        </div>
      </div>
      <p className="market-disclaimer">
        GREEN LINK 토큰은 농장 소유권, 증권, 배당권 또는 수익 보장을 의미하지
        않으며 현재 결제는 실제 원화가 아닌 모의 크레딧입니다.
      </p>
      <ErrorBox message={error} />
      <PublicMarketplace notify={notify} />
      <div className="order-grid">
        {data?.map((o) => (
          <article className="order-card" key={o.id}>
            <div className="order-top">
              <span>{o.tokenId}</span>
              <Status value={o.status} />
            </div>
            <div className="order-crop">
              <Sprout />
              <div>
                <small>{o.container?.cropName}</small>
                <h3>{o.container?.name}</h3>
              </div>
            </div>
            <dl>
              <div>
                <dt>판매자</dt>
                <dd>{o.sellerName}</dd>
              </div>
              <div>
                <dt>남은 수량</dt>
                <dd>{o.remainingQuantity ?? o.quantity}개</dd>
              </div>
              <div>
                <dt>개당 가격</dt>
                <dd>{won(o.unitPrice)}</dd>
              </div>
            </dl>
            <div className="order-total">
              <span>최소 구매 금액</span>
              <strong>{won(o.unitPrice)}</strong>
            </div>
            <button
              className="primary-btn"
              onClick={() => {
                setBuy(o);
                setQuantity(1);
              }}
            >
              <ShoppingCart /> 구매하기
            </button>
          </article>
        ))}
      </div>
      {buy && (
        <Modal title="토큰 구매" close={() => setBuy(null)}>
          <div className="purchase-info">
            <span>{buy.tokenId}</span>
            <h3>{buy.container.name}</h3>
            <p>
              남은 판매 수량 {buy.remainingQuantity ?? buy.quantity}개 · 개당{" "}
              {won(buy.unitPrice)}
            </p>
          </div>
          <label className="field">
            구매 수량
            <input
              type="number"
              min={1}
              max={buy.remainingQuantity ?? buy.quantity}
              value={quantity}
              onChange={(e) => setQuantity(Number(e.target.value))}
            />
          </label>
          <div className="checkout">
            <span>개발용 모의 크레딧 차감</span>
            <strong>{won(buy.unitPrice * quantity)}</strong>
          </div>
          <p className="asset-note">
            체결과 결제는 내부 DB 트랜잭션으로 동시에 확정되고 원장에
            기록됩니다.
          </p>
          <button className="primary-btn" onClick={purchase} disabled={buying}>
            {buying ? "처리 중…" : "구매 확정"}
          </button>
        </Modal>
      )}
    </>
  );
}

function WalletPage({
  notify,
  go,
}: {
  notify: (m: string) => void;
  go: (page: string, id?: string) => void;
}) {
  const { data, error, reload } = useLoad<Wallet>("/wallet");
  const [sell, setSell] = useState<Holding | null>(null),
    [qty, setQty] = useState(1),
    [price, setPrice] = useState(100000),
    [selling, setSelling] = useState(false),
    [cancellingId, setCancellingId] = useState("");
  const cropSummary = data
    ? [
        ...new Set(
          [...data.holdings, ...data.openOrders].map(
            (item) => item.container.cropName,
          ),
        ),
      ]
        .slice(0, 3)
        .join(" · ")
    : "";
  const containerCount = data
    ? new Set([
        ...data.holdings.map((holding) => holding.containerId),
        ...data.openOrders.map((order) => order.containerId),
      ]).size
    : 0;
  async function submitSell() {
    if (!sell) return;
    setSelling(true);
    try {
      await api("/orders", {
        method: "POST",
        body: JSON.stringify({
          tokenId: sell.tokenId,
          quantity: qty,
          unitPrice: price,
          idempotencyKey: requestKey(),
        }),
      });
      notify("판매 주문이 등록되었습니다.");
      setSell(null);
      reload();
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setSelling(false);
    }
  }
  async function cancelOrder(id: string) {
    setCancellingId(id);
    try {
      await api(`/orders/${id}/cancel`, { method: "POST" });
      notify("판매 주문을 취소하고 수량을 보유 토큰으로 돌렸습니다.");
      reload();
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setCancellingId("");
    }
  }
  return (
    <>
      <Header title="내 지갑" subtitle="DIGITAL FARM ASSETS" />
      <ErrorBox message={error} />
      {!data ? (
        !error && <Loader />
      ) : (
        <>
          <section className="wallet-overview">
            <div className="wallet-overview-top">
              <span>스마트팜 참여 현황</span>
              <small>내 지갑</small>
            </div>
            <h2>{containerCount}개 컨테이너</h2>
            <p className="wallet-overview-note">
              {cropSummary || "참여 중인 작물이 없습니다."}
            </p>
            <div className="wallet-account-summary">
              <span>
                사용 가능
                <strong>{data.availableTokens.toLocaleString()}개</strong>
              </span>
              <span>
                판매 예약
                <strong>{data.listedTokens.toLocaleString()}개</strong>
              </span>
              <span>
                정산 완료
                <strong>{data.settledTokens.toLocaleString()}개</strong>
              </span>
              <span>
                지갑 잔액<strong>{won(data.mockCreditBalance)}</strong>
              </span>
            </div>
            <button onClick={() => go("market")}>
              <Sprout /> 새 스마트팜 둘러보기
            </button>
          </section>

          <section className="wallet-section">
            <header className="wallet-section-header">
              <h2>보유 토큰</h2>
              <span>{data.holdings.length}개 컨테이너</span>
            </header>
            <div className="wallet-position-list">
              {data.holdings.length ? (
                data.holdings.map((h) => (
                  <article className="wallet-position" key={h.id}>
                    <div className="wallet-position-top">
                      <div className="holding-icon">
                        <Leaf />
                      </div>
                      <div className="wallet-position-name">
                        <strong>{h.container.name}</strong>
                        <small>
                          {h.tokenId} · 사용 가능{" "}
                          {(h.availableQuantity ?? h.quantity).toLocaleString()}
                          개 · 판매 예약{" "}
                          {(h.reservedQuantity ?? 0).toLocaleString()}개
                          {(h.unsettledQuantity ?? 0) > 0
                            ? ` · 정산 대기 ${h.unsettledQuantity?.toLocaleString()}개`
                            : ""}
                        </small>
                      </div>
                      <div className="wallet-position-value">
                        <ContainerState value={h.container.status} />
                      </div>
                    </div>
                    <div className="wallet-position-bottom">
                      <span>
                        작물 <b>{h.container.cropName}</b>
                      </span>
                      <span>
                        수확 일정 <b>{shortDate(h.container.harvestAt)}</b>
                      </span>
                      <span>
                        참여 금액 <b>{won(h.quantity * h.averagePrice)}</b>
                      </span>
                      <button
                        disabled={(h.availableQuantity ?? h.quantity) < 1}
                        onClick={() => {
                          setSell(h);
                          setQty(1);
                          setPrice(h.averagePrice);
                        }}
                      >
                        판매
                      </button>
                    </div>
                  </article>
                ))
              ) : (
                <Empty icon={WalletCards}>
                  사용 가능한 보유 토큰이 없습니다.
                </Empty>
              )}
            </div>
          </section>

          <section className="wallet-section">
            <header className="wallet-section-header">
              <h2>판매 중</h2>
              <span>{data.openOrders.length}건</span>
            </header>
            {data.openOrders.length ? (
              <div className="wallet-position-list">
                {data.openOrders.map((order) => (
                  <article className="wallet-position" key={order.id}>
                    <div className="wallet-position-top">
                      <div className="holding-icon">
                        <Store />
                      </div>
                      <div className="wallet-position-name">
                        <strong>{order.container.name}</strong>
                        <small>
                          {order.tokenId} · {order.quantity.toLocaleString()}개
                        </small>
                      </div>
                      <div className="wallet-position-value">
                        <Status value="판매중" />
                      </div>
                    </div>
                    <div className="wallet-position-bottom">
                      <span>
                        개당 가격 <b>{won(order.unitPrice)}</b>
                      </span>
                      <span>
                        판매 예정 <b>{won(order.unitPrice * order.quantity)}</b>
                      </span>
                      <span>
                        등록일 <b>{shortDate(order.createdAt)}</b>
                      </span>
                      <button
                        disabled={cancellingId === order.id}
                        onClick={() => cancelOrder(order.id)}
                      >
                        {cancellingId === order.id ? "취소 중…" : "판매 취소"}
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <Empty icon={Store}>현재 판매 중인 주문이 없습니다.</Empty>
            )}
          </section>

          <section className="wallet-section">
            <header className="wallet-section-header">
              <h2>거래내역</h2>
              <span>최근 {data.transactions.length}건</span>
            </header>
            {data.transactions.length ? (
              <div className="wallet-history-list">
                {data.transactions.map((t) => (
                  <div key={t.id}>
                    <span className={t.type === "구매" ? "buy" : "sell"}>
                      {t.type === "구매" ? <ShoppingCart /> : <Coins />}
                    </span>
                    <div>
                      <strong>{t.tokenId}</strong>
                      <small>{date(t.createdAt)}</small>
                    </div>
                    <div className="wallet-history-value">
                      <strong>{won(t.unitPrice * t.quantity)}</strong>
                      <small>
                        {t.type} · {t.quantity.toLocaleString()}개
                      </small>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <Empty icon={BarChart3}>아직 거래 내역이 없습니다.</Empty>
            )}
          </section>
        </>
      )}
      {sell && (
        <Modal title="판매 주문 등록" close={() => setSell(null)}>
          <div className="purchase-info">
            <span>{sell.tokenId}</span>
            <h3>{sell.container.name}</h3>
            <p>사용 가능 {sell.availableQuantity ?? sell.quantity}개</p>
          </div>
          <div className="form-row">
            <label className="field">
              수량
              <input
                type="number"
                min={1}
                max={sell.availableQuantity ?? sell.quantity}
                value={qty}
                onChange={(e) => setQty(Number(e.target.value))}
              />
            </label>
            <label className="field">
              개당 가격
              <input
                type="number"
                min={1000}
                step={1000}
                value={price}
                onChange={(e) => setPrice(Number(e.target.value))}
              />
            </label>
          </div>
          <div className="checkout">
            <span>판매 예정 금액</span>
            <strong>{won(price * qty)}</strong>
          </div>
          <p className="asset-note">
            등록 수량은 사용 가능 수량에서 빠지고 판매 예약 수량으로 이동합니다.
          </p>
          <button
            className="primary-btn"
            onClick={submitSell}
            disabled={selling}
          >
            {selling ? "등록 중…" : "판매 등록"}
          </button>
        </Modal>
      )}
    </>
  );
}

function AdminRegistration({ notify }: { notify: (m: string) => void }) {
  const { data: farms, reload } = useLoad<Farm[]>("/farms");
  const { data: containers, reload: reloadContainers } =
    useLoad<Container[]>("/containers");
  const { data: tokenRequests, reload: reloadTokenRequests } = useLoad<
    TokenRequest[]
  >("/admin/token-requests");
  const [tab, setTab] = useState("farm");
  const [contentContainerId, setContentContainerId] = useState("");
  const [approvingRequestId, setApprovingRequestId] = useState("");
  const contentContainer = containers?.find(
    (item) => item.id === contentContainerId,
  );
  const tokenContainers =
    containers?.filter(
      (item) => item.totalTokenSupply === 0 && item.tokenStatus !== "requested",
    ) || [];
  async function approveRequest(request: TokenRequest) {
    setApprovingRequestId(request.id);
    try {
      await api(`/admin/tokens/${request.containerId}/approve`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      notify(`${request.symbol} 발행을 승인했습니다.`);
      reloadContainers();
      reloadTokenRequests();
    } catch (err) {
      notify((err as Error).message);
    } finally {
      setApprovingRequestId("");
    }
  }
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formElement = e.currentTarget;
    const form = new FormData(formElement);
    const values: Record<string, unknown> = Object.fromEntries(form.entries());
    const endpoint =
      tab === "farm"
        ? "/admin/farms"
        : tab === "container"
          ? "/admin/containers"
          : tab === "content"
            ? `/admin/containers/${contentContainerId}/content`
            : "/admin/tokens";
    if (tab === "token") {
      values.supply = Number(values.supply);
      values.price = Number(values.price);
    }
    if (tab === "content") {
      values.rackViews = defaultRackViews.map((rack) => ({
        id: rack.id,
        label: values[`${rack.id}Label`],
        detail: values[`${rack.id}Detail`],
      }));
    }
    try {
      await api(endpoint, {
        method: tab === "content" ? "PATCH" : "POST",
        body: JSON.stringify(values),
      });
      if (tab !== "content") formElement.reset();
      notify(
        tab === "content"
          ? "페이지 문구를 저장했습니다."
          : "관리자 작업이 완료되었습니다.",
      );
      reload();
      reloadContainers();
      reloadTokenRequests();
    } catch (err) {
      notify((err as Error).message);
    }
  }
  return (
    <>
      <Header title="관리자 콘솔" subtitle="PLATFORM OPERATIONS" />
      <section className="admin-panel">
        <div className="admin-tabs">
          <button
            className={tab === "farm" ? "active" : ""}
            onClick={() => setTab("farm")}
          >
            <Warehouse />
            농장 등록
          </button>
          <button
            className={tab === "container" ? "active" : ""}
            onClick={() => setTab("container")}
          >
            <Boxes />
            컨테이너 등록
          </button>
          <button
            className={tab === "token" ? "active" : ""}
            onClick={() => setTab("token")}
          >
            <Coins />
            토큰 발행
          </button>
          <button
            className={tab === "content" ? "active" : ""}
            onClick={() => setTab("content")}
          >
            <Settings />
            페이지 문구
          </button>
        </div>
        <form onSubmit={submit}>
          <p className="eyebrow">{tab.toUpperCase()} MANAGEMENT</p>
          <h2>
            {tab === "farm"
              ? "새 농장 등록"
              : tab === "container"
                ? "새 컨테이너 등록"
                : tab === "content"
                  ? "컨테이너·랙 설명 수정"
                  : "농장주 토큰 발행 승인"}
          </h2>
          {tab === "farm" && (
            <>
              <div className="form-row">
                <label className="field">
                  농장명
                  <input name="name" required placeholder="예: 경산 D팜" />
                </label>
                <label className="field">
                  운영자 ID
                  <input name="ownerId" placeholder="기본: admin" />
                </label>
              </div>
              <label className="field">
                주소
                <input name="address" required placeholder="도로명 주소" />
              </label>
              <label className="field">
                농장 설명
                <textarea name="description" rows={3} />
              </label>
            </>
          )}
          {tab === "container" && (
            <>
              <label className="field">
                소속 농장
                <select name="farmId" required>
                  <option value="">선택</option>
                  {farms?.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="form-row">
                <label className="field">
                  컨테이너명
                  <input name="name" required />
                </label>
                <label className="field">
                  재배 작물
                  <input name="cropName" required />
                </label>
              </div>
              <label className="field">
                설명
                <textarea name="description" rows={3} />
              </label>
            </>
          )}
          {tab === "token" && (
            <>
              {!!tokenRequests?.length && (
                <div className="token-request-list">
                  {tokenRequests.map((request) => (
                    <article key={request.id}>
                      <div>
                        <strong>{request.symbol}</strong>
                        <small>
                          {request.farmName} · {request.containerName} ·{" "}
                          {request.totalSupply.toLocaleString()}개 ·{" "}
                          {won(request.initialPrice)}
                        </small>
                      </div>
                      <button
                        type="button"
                        disabled={approvingRequestId === request.id}
                        onClick={() => approveRequest(request)}
                      >
                        {approvingRequestId === request.id
                          ? "승인 중…"
                          : "승인"}
                      </button>
                    </article>
                  ))}
                </div>
              )}
              <label className="field">
                발행 대상 컨테이너
                <select name="containerId" required>
                  <option value="">선택</option>
                  {tokenContainers.map((container) => (
                    <option key={container.id} value={container.id}>
                      {container.name} · {container.cropName}
                    </option>
                  ))}
                </select>
              </label>
              <p className="issuance-note">
                승인된 토큰은 관리자가 아니라 해당 농장의 운영자 보유량으로 먼저
                기록됩니다.
              </p>
              <div className="form-row">
                <label className="field">
                  발행량
                  <input
                    name="supply"
                    type="number"
                    min="1"
                    defaultValue={10}
                    required
                  />
                </label>
                <label className="field">
                  초기 참고 가격
                  <input
                    name="price"
                    type="number"
                    min="1000"
                    step="1000"
                    placeholder="예: 100000"
                    required
                  />
                </label>
              </div>
            </>
          )}
          {tab === "content" && (
            <>
              <label className="field">
                수정할 컨테이너
                <select
                  required
                  value={contentContainerId}
                  onChange={(event) =>
                    setContentContainerId(event.target.value)
                  }
                >
                  <option value="">선택</option>
                  {containers?.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
              {contentContainer && (
                <div
                  key={`${contentContainer.id}-${contentContainer.updatedAt || ""}`}
                >
                  <label className="field">
                    컨테이너 설명
                    <textarea
                      name="description"
                      rows={4}
                      defaultValue={contentContainer.description}
                      maxLength={500}
                    />
                  </label>
                  <div className="rack-copy-fields">
                    {(contentContainer.rackViews || defaultRackViews).map(
                      (rack, index) => (
                        <fieldset key={rack.id}>
                          <legend>랙 {String.fromCharCode(65 + index)}</legend>
                          <label className="field">
                            표시 이름
                            <input
                              name={`${rack.id}Label`}
                              defaultValue={rack.label}
                              maxLength={40}
                              required
                            />
                          </label>
                          <label className="field">
                            짧은 설명
                            <input
                              name={`${rack.id}Detail`}
                              defaultValue={rack.detail}
                              maxLength={80}
                              required
                            />
                          </label>
                        </fieldset>
                      ),
                    )}
                  </div>
                </div>
              )}
            </>
          )}
          <button className="primary-btn">
            {tab === "content" ? <Settings /> : <Plus />}
            {tab === "token"
              ? "토큰 발행"
              : tab === "content"
                ? "문구 저장"
                : "등록 완료"}
          </button>
        </form>
      </section>
    </>
  );
}

function AdminPage({ notify }: { notify: (m: string) => void }) {
  return (
    <>
      <AdminRegistration notify={notify} />
      <AdminOperations notify={notify} />
    </>
  );
}

function ProfilePage({
  user,
  update,
  logout,
}: {
  user: User;
  update: (u: User) => void;
  logout: () => void;
}) {
  const [name, setName] = useState(user.name),
    [phone, setPhone] = useState(user.phone),
    [message, setMessage] = useState(""),
    [currentPassword, setCurrentPassword] = useState(""),
    [newPassword, setNewPassword] = useState(""),
    [confirmPassword, setConfirmPassword] = useState(""),
    [passwordMessage, setPasswordMessage] = useState(""),
    [passwordBusy, setPasswordBusy] = useState(false);
  async function save(e: FormEvent) {
    e.preventDefault();
    try {
      const next = await api<User>("/me", {
        method: "PATCH",
        body: JSON.stringify({ name, phone }),
      });
      update(next);
      setMessage("프로필을 저장했습니다.");
    } catch (err) {
      setMessage((err as Error).message);
    }
  }
  async function changePassword(e: FormEvent) {
    e.preventDefault();
    setPasswordMessage("");
    if (newPassword !== confirmPassword) {
      setPasswordMessage("새 비밀번호 확인이 일치하지 않습니다.");
      return;
    }
    setPasswordBusy(true);
    try {
      await api("/me/password", {
        method: "PATCH",
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordMessage(
        "비밀번호를 변경했습니다. 다른 기기의 로그인은 해제됩니다.",
      );
    } catch (err) {
      setPasswordMessage((err as Error).message);
    } finally {
      setPasswordBusy(false);
    }
  }
  return (
    <>
      <Header title="프로필" subtitle="ACCOUNT SETTINGS" />
      <div className="profile-layout">
        <section className="profile-card">
          <div className="large-avatar">{user.name[0]}</div>
          <h2>{user.name}</h2>
          <p>{user.email}</p>
          <Status value={user.role === "admin" ? "관리자" : "인증 회원"} />
          <button className="outline-btn danger-text" onClick={logout}>
            <LogOut />
            로그아웃
          </button>
        </section>
        <div className="profile-form-stack">
          <form className="profile-form" onSubmit={save}>
            <p className="eyebrow">PERSONAL INFORMATION</p>
            <h2>기본 정보</h2>
            {message && <div className="save-message">{message}</div>}
            <label className="field">
              이름
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </label>
            <label className="field">
              이메일
              <input value={user.email} disabled />
            </label>
            <label className="field">
              연락처
              <input value={phone} onChange={(e) => setPhone(e.target.value)} />
            </label>
            <button className="primary-btn">변경사항 저장</button>
          </form>
          <form className="profile-form" onSubmit={changePassword}>
            <p className="eyebrow">SECURITY</p>
            <h2>비밀번호 변경</h2>
            {passwordMessage && (
              <div className="save-message">{passwordMessage}</div>
            )}
            <label className="field">
              현재 비밀번호
              <input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </label>
            <label className="field">
              새 비밀번호
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
                minLength={8}
                maxLength={128}
                required
              />
            </label>
            <label className="field">
              새 비밀번호 확인
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                minLength={8}
                maxLength={128}
                required
              />
            </label>
            <button className="primary-btn" disabled={passwordBusy}>
              {passwordBusy ? "변경 중…" : "비밀번호 변경"}
            </button>
          </form>
        </div>
      </div>
      <WalletLink user={user} update={update} />
    </>
  );
}

function Modal({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: ReactNode;
}) {
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && close()}
    >
      <section className="modal">
        <header>
          <h2>{title}</h2>
          <button onClick={close}>
            <X />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState<User | null>(null),
    [loading, setLoading] = useState(true),
    [route, setRoute] = useState<Route>({ page: "dashboard" }),
    [toast, setToast] = useState("");
  useEffect(() => {
    try {
      localStorage.removeItem("smartfarm-token");
    } catch {
      // Storage may be unavailable in a locked-down browser; cookie auth still works.
    }
    api<User>("/me")
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    const expired = () => {
      setUser(null);
      setRoute({ page: "dashboard" });
    };
    window.addEventListener("green-link-auth-expired", expired);
    return () => window.removeEventListener("green-link-auth-expired", expired);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 3500);
    return () => clearTimeout(timer);
  }, [toast]);
  const go = (page: string, id?: string) => {
    setRoute({ page, id });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const logout = async () => {
    try {
      await api("/auth/logout", { method: "POST" });
    } catch {}
    setUser(null);
    setRoute({ page: "dashboard" });
  };
  if (loading) return <Loader />;
  if (!user) return <Login onLogin={setUser} />;
  let page: ReactNode;
  if (route.page === "dashboard")
    page = <DashboardPage go={go} notify={setToast} />;
  else if (route.page === "map") page = <MapPage go={go} />;
  else if (route.page === "myfarm") page = <MyFarmPage go={go} />;
  else if (route.page === "farm" && route.id)
    page = <FarmDetail id={route.id} go={go} />;
  else if (route.page === "container" && route.id)
    page = (
      <ContainerDetail id={route.id} go={go} user={user} notify={setToast} />
    );
  else if (route.page === "market") page = <MarketPage notify={setToast} />;
  else if (route.page === "wallet")
    page = <WalletPage notify={setToast} go={go} />;
  else if (route.page === "admin" && user.role === "admin")
    page = <AdminPage notify={setToast} />;
  else if (route.page === "profile")
    page = <ProfilePage user={user} update={setUser} logout={logout} />;
  else page = <DashboardPage go={go} notify={setToast} />;
  return (
    <Shell user={user} route={route} go={go} logout={logout}>
      {page}
      {toast && (
        <div className="toast">
          <PackageCheck />
          {toast}
        </div>
      )}
    </Shell>
  );
}
