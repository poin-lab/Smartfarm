import { FormEvent, useEffect, useState } from "react";
import {
  Activity,
  Camera,
  Cpu,
  FileCheck2,
  Radio,
  Send,
} from "lucide-react";
import { api } from "../api";
import type {
  AdminSummary,
  Container,
  Device,
  LedgerBlock,
} from "../model";

function useAdminData<T>(path: string, refresh: number) {
  const [data, setData] = useState<T | null>(null);
  useEffect(() => {
    setData(null);
    api<T>(path)
      .then(setData)
      .catch(() => undefined);
  }, [path, refresh]);
  return data;
}

export function AdminOperations({
  notify,
}: {
  notify: (message: string) => void;
}) {
  const [refresh, setRefresh] = useState(0);
  const summary = useAdminData<AdminSummary>("/admin/summary", refresh);
  const devices = useAdminData<Device[]>("/admin/iot/devices", refresh);
  const containers = useAdminData<Container[]>("/containers", refresh);
  const ledger = useAdminData<{
    verification: { valid: boolean; count: number };
    blocks: LedgerBlock[];
  }>("/ledger/blocks?limit=20", refresh);
  const reload = () => setRefresh((value) => value + 1);
  async function provision(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form));
    try {
      const result = await api<{ apiKey: string }>("/admin/iot/devices", {
        method: "POST",
        body: JSON.stringify(values),
      });
      notify(`장비 키(1회 표시): ${result.apiKey}`);
      form.reset();
      reload();
    } catch (error) {
      notify((error as Error).message);
    }
  }
  async function camera(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form));
    try {
      await api(`/admin/cameras/${values.containerId}`, {
        method: "PUT",
        body: JSON.stringify({ hlsUrl: values.hlsUrl, status: "online" }),
      });
      notify("HLS 카메라가 저장되었습니다.");
      form.reset();
    } catch (error) {
      notify((error as Error).message);
    }
  }
  async function control(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form));
    try {
      await api(`/containers/${values.containerId}/climate/commands`, {
        method: "POST",
        body: JSON.stringify({
          targetTemperature: Number(values.targetTemperature),
          mode: values.mode,
          fan: values.fan === "on",
        }),
      });
      notify("제어 명령이 큐에 등록되었습니다.");
      form.reset();
      reload();
    } catch (error) {
      notify((error as Error).message);
    }
  }
  return (
    <section className="ops-console">
      <div className="admin-stats">
        <div>
          <Cpu />
          <span>
            컨테이너<strong>{summary?.containerCount ?? "–"}</strong>
          </span>
        </div>
        <div>
          <Radio />
          <span>
            온라인 장비<strong>{summary?.onlineDevices ?? "–"}</strong>
          </span>
        </div>
        <div>
          <Activity />
          <span>
            대기 명령<strong>{summary?.queuedCommands ?? "–"}</strong>
          </span>
        </div>
        <div>
          <FileCheck2 />
          <span>
            원장 블록<strong>{summary?.ledgerBlocks ?? "–"}</strong>
          </span>
        </div>
      </div>
      <div className="ops-grid">
        <form onSubmit={provision}>
          <h2>
            <Cpu /> 장비 프로비저닝
          </h2>
          <label className="field">
            컨테이너
            <select name="containerId" required>
              <option value="">선택</option>
              {containers?.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            장비명
            <input name="name" required />
          </label>
          <label className="field">
            유형
            <select name="deviceType">
              <option value="sensor">센서</option>
              <option value="controller">컨트롤러</option>
              <option value="camera">카메라</option>
            </select>
          </label>
          <button className="primary-btn">
            <Cpu /> 키 발급
          </button>
        </form>
        <form onSubmit={camera}>
          <h2>
            <Camera /> HLS 카메라
          </h2>
          <label className="field">
            컨테이너
            <select name="containerId" required>
              <option value="">선택</option>
              {containers?.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            HLS URL
            <input
              name="hlsUrl"
              type="url"
              placeholder="https://…/index.m3u8"
              required
            />
          </label>
          <p>브라우저용 HTTP(S) .m3u8 주소만 등록됩니다.</p>
          <button className="primary-btn">
            <Camera /> 카메라 저장
          </button>
        </form>
        <form onSubmit={control}>
          <h2>
            <Send /> 환경 제어
          </h2>
          <label className="field">
            컨테이너
            <select name="containerId" required>
              <option value="">선택</option>
              {containers?.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <div className="form-row">
            <label className="field">
              목표 온도
              <input
                name="targetTemperature"
                type="number"
                min="5"
                max="45"
                step="0.5"
                defaultValue="23"
              />
            </label>
            <label className="field">
              모드
              <select name="mode">
                <option value="auto">자동</option>
                <option value="cool">냉방</option>
                <option value="heat">난방</option>
                <option value="ventilate">환기</option>
                <option value="off">정지</option>
              </select>
            </label>
          </div>
          <label className="check-field">
            <input name="fan" type="checkbox" /> 팬 가동
          </label>
          <button className="primary-btn">
            <Send /> 명령 전송
          </button>
        </form>
      </div>
      <div className="ops-grid">
        <article className="ops-table">
          <h2>장비 상태</h2>
          {devices?.length ? (
            devices.map((item) => (
              <div key={item.id}>
                <span>
                  {item.name}
                  <small>
                    {item.containerId} · {item.deviceType}
                  </small>
                </span>
                <b>{item.status}</b>
              </div>
            ))
          ) : (
            <p>등록된 장비가 없습니다.</p>
          )}
        </article>
        <article className="ops-table">
          <h2>
            위변조 검증형 감사 원장{" "}
            <b
              className={ledger?.verification.valid ? "healthy" : "danger-text"}
            >
              {ledger?.verification.valid ? "검증 정상" : "확인 필요"}
            </b>
          </h2>
          {ledger?.blocks.map((block) => (
            <div key={block.height}>
              <span>
                #{block.height} {block.eventType}
                <small>
                  {block.entityType} · {block.entityId}
                </small>
              </span>
              <code>{block.blockHash.slice(0, 12)}…</code>
            </div>
          ))}
        </article>
      </div>
    </section>
  );
}
