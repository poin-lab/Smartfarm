# GREEN LINK 외부 네트워크 접속

이 문서는 같은 Wi-Fi가 아닌 사람도 GREEN LINK에 접속하게 하는 방법을 설명한다.

## 결론

`192.168.x.x` 주소는 같은 공유기 안에서만 보이는 사설 IP다. 다른 와이파이, LTE/5G, 외부 네트워크에서 접속하려면 공인 접근 경로가 필요하다.

GREEN LINK에는 시연용으로 Cloudflare Quick Tunnel 실행 스크립트를 추가했다.

```text
start-green-link-public.cmd
```

이 파일을 실행하면 앱 서버를 열고 다음 형태의 공개 HTTPS 주소를 출력한다.

```text
https://example.trycloudflare.com
```

다른 네트워크의 노트북이나 스마트폰은 이 HTTPS 주소로 접속하면 된다.

## 구조

```text
외부 사용자 브라우저
  -> https://랜덤.trycloudflare.com
      -> Cloudflare Tunnel
          -> 서버 PC의 http://localhost:4100
              -> Express API + React 정적 파일
                  -> server/data/smartfarm.sqlite
```

SQLite 파일은 외부로 열지 않는다. 외부 사용자는 웹 서버만 접속하고, DB 접근은 서버 PC의 Express API가 담당한다.

## 실행

서버 PC에서 다음 파일을 더블클릭한다.

```text
start-green-link-public.cmd
```

처음 실행하면 `npx`가 `cloudflared`를 임시 실행하므로 인터넷 연결이 필요하다. 터미널에 다음 문구가 나오면 공개 접속 준비가 끝난다.

```text
PUBLIC URL for any network:
  https://example.trycloudflare.com
Share this HTTPS address while this window stays open.
```

터미널 창을 닫거나 `Ctrl+C`를 누르면 공개 주소도 종료된다.

## LAN 주소와 공개 주소 차이

| 주소 예시                           | 접속 가능 범위                         |
| ----------------------------------- | -------------------------------------- |
| `http://localhost:4100`             | 서버 PC 자기 자신                      |
| `http://192.168.0.189:4100`         | 같은 Wi-Fi 또는 같은 공유기 안         |
| `http://100.103.63.104:4100`        | Tailscale 같은 VPN에 같이 들어온 기기  |
| `https://example.trycloudflare.com` | 다른 와이파이, LTE/5G 등 외부 네트워크 |

## 고정 도메인을 쓰려면

Quick Tunnel 주소는 실행할 때마다 바뀌는 임시 주소다. `greenlink.example.com` 같은 고정 도메인을 쓰려면 다음 중 하나가 필요하다.

1. 도메인 구매
2. Cloudflare 같은 DNS 서비스에 도메인 연결
3. 고정 tunnel 생성
4. DNS CNAME을 tunnel에 연결
5. 서버 PC에서 인증된 `cloudflared tunnel run` 실행

도메인이 없으면 고정 도메인은 만들 수 없다. 제출·시연만 목적이면 `start-green-link-public.cmd`가 출력하는 임시 HTTPS 주소를 공유하면 충분하다.

## 보안 주의

공개 터널은 인터넷에서 접근 가능한 주소를 만든다.

- 시연이 끝나면 터미널에서 `Ctrl+C`로 종료한다.
- 실제 개인정보, 실제 결제, 실제 투자성 상품에는 사용하지 않는다.
- 데모 계정 비밀번호를 운영용으로 쓰지 않는다.
- 장시간 공개 운영하려면 HTTPS reverse proxy, 강한 운영 비밀키, 관리자 계정 정책, 백업, 로그, 접근 제한을 별도로 구성한다.
