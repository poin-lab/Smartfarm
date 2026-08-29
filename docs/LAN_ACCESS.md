# GREEN LINK LAN 접속

이 문서는 한 대의 Windows PC에서 GREEN LINK를 열고 같은 Wi-Fi의 노트북이나 스마트폰이 접속하는 방법을 설명한다.

## 구조

SQLite는 네트워크 DB 서버가 아니다. DB 파일은 서버 PC에만 있고, 다른 기기는 브라우저로 GREEN LINK 웹/API 서버에 접속한다.

```text
스마트폰/노트북 브라우저
  -> http://서버PC-IP:4100
      -> Express API + React 정적 파일
          -> server/data/smartfarm.sqlite
```

이 구조에서는 SQLite 파일을 공유 폴더로 열지 않는다. 모든 읽기·쓰기는 서버 PC의 Express API 한 프로세스를 통해 처리된다.

## 실행

서버로 쓸 PC에서 다음 파일을 더블클릭한다.

```text
start-green-link-lan.cmd
```

이 스크립트는 다음 작업을 수행한다.

1. `.env`가 없으면 `.env.example`에서 생성
2. `node_modules`가 없으면 `npm ci`
3. SQLite 생성·migration 실행
4. React 앱 production build
5. `HOST=0.0.0.0`, 기본 `PORT=4100`으로 API와 웹을 한 포트에서 실행
6. 같은 네트워크에서 쓸 LAN URL 출력

터미널에 다음과 비슷하게 표시된다.

```text
Local: http://localhost:4100
LAN URLs for phones and laptops on the same network:
  http://192.168.0.189:4100
```

다른 기기에서는 `localhost`가 아니라 표시된 LAN URL을 브라우저 주소창에 입력한다.

## 접속 조건

- 서버 PC와 접속 기기가 같은 Wi-Fi 또는 같은 LAN에 있어야 한다.
- 서버 PC가 절전 모드로 들어가면 접속이 끊긴다.
- Windows Defender Firewall에서 Node.js의 Private network 접근을 허용해야 한다.
- 학교·회사 Wi-Fi처럼 기기 간 통신을 막는 네트워크에서는 접속이 안 될 수 있다.
- VPN, 모바일 핫스팟, Tailscale 같은 가상 네트워크를 쓰면 표시되는 IP가 여러 개일 수 있다. 같은 네트워크의 IP를 선택한다.

## 개발 모드와 LAN 모드 차이

| 실행 파일                  | 용도                        | 접속 주소                                  |
| -------------------------- | --------------------------- | ------------------------------------------ |
| `start-green-link.cmd`     | 개발 중 API+Vite hot reload | `http://localhost:5177` 또는 LAN의 `:5177` |
| `start-green-link-lan.cmd` | 제출·시연용 단일 서버       | `http://서버PC-IP:4100`                    |

제출·시연에는 `start-green-link-lan.cmd`를 권장한다. 한 포트만 열면 되고, 스마트폰도 API 주소를 따로 설정하지 않는다.

## 보안 주의

이 앱은 제출·시연용 데모다.

- 실제 원화 결제나 실제 투자 상품으로 운영하지 않는다.
- 공용 Wi-Fi에서 장시간 열어두지 않는다.
- 시연이 끝나면 터미널에서 `Ctrl+C`로 서버를 종료한다.
- 운영 환경에 공개하려면 `NODE_ENV=production`, 강한 `BLOCKCHAIN_SIGNING_KEY`, HTTPS reverse proxy, 실사용 계정 정책, 백업·접근 로그·방화벽 정책을 별도로 구성한다.
