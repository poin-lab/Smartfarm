# GREEN LINK 일반 사용자 인증

이 문서는 현재 구현된 일반 사용자 가입·로그인 구조를 설명한다. 전체 endpoint는 [docs/API.md](./docs/API.md), 실제 테이블은 [docs/DATABASE.md](./docs/DATABASE.md)를 기준으로 한다.

## 1. 범위

현재 포함:

- 일반 사용자 회원가입
- SQLite 사용자 로그인
- HttpOnly 쿠키 세션
- 로그인 상태 확인과 로그아웃
- 이름·연락처 수정
- 현재 비밀번호 확인 후 비밀번호 변경
- 계정 상태와 마지막 로그인 시각

현재 제외:

- 이메일 인증과 비밀번호 재설정 메일
- 소셜 로그인과 MFA
- 관리자 사용자 관리 화면
- 실명·금융 계좌 인증
- 외부 증권사 계정 연결

기존 `admin` 역할과 관리자 기능은 호환을 위해 남아 있지만 현재 사용자 기능의 우선 범위는 아니다.

## 2. 사용자 데이터

### users

```text
id
name
email                  UNIQUE, 대소문자 구분 없음
password_hash
role                   user / admin
phone
status                 active / suspended / withdrawn
credit_balance         개발용 모의 크레딧
wallet_address         선택형 EVM 지갑
last_login_at
password_changed_at
created_at
updated_at
```

회원가입은 클라이언트 입력과 관계없이 항상 `role=user`, `status=active`로 생성한다.

### sessions

```text
token_hash             PRIMARY KEY
user_id                users FK
expires_at
created_at
```

원문 세션은 브라우저 쿠키에만 전달하고 DB에는 SHA-256 해시만 저장한다.

## 3. 비밀번호

현재 사용자 입력 규칙은 필요한 범위로 단순화한다.

```text
최소 8자
최대 128자
문자 조합 강제 없음
별도 흔한 비밀번호 차단 없음
Unicode NFC 정규화
```

저장 시 Node.js 비동기 scrypt를 사용한다.

```text
scrypt$32768$8$3$<salt>$<derived-key>
```

- 사용자마다 16바이트 무작위 salt
- 원문 비밀번호 저장 금지
- 기존 개발 계정의 구형 scrypt 형식도 로그인 가능
- 구형 해시는 로그인 성공 시 새 형식으로 자동 갱신

## 4. 세션

```text
토큰: 32바이트 암호학적 난수
DB: 토큰 SHA-256 해시
유효시간: 기본 12시간
브라우저: HttpOnly, SameSite=Lax, Path=/
production: Secure, __Host- 접두사
```

브라우저는 `localStorage`에 로그인 토큰을 저장하지 않는다. 앱 시작 시 `GET /api/me`로 쿠키 세션을 확인한다.

쿠키 인증으로 데이터를 변경하는 요청은 다음 헤더를 사용한다.

```http
X-Green-Link-Request: 1
```

비밀번호를 변경하면 현재 세션만 유지하고 같은 사용자의 다른 세션을 삭제한다.

## 5. 호출 흐름

### 회원가입

```text
이름·이메일·비밀번호 입력
→ 이메일 형식과 중복 확인
→ 비밀번호 길이 확인·scrypt 해시
→ users 생성
→ sessions 생성
→ HttpOnly 쿠키 설정
→ 로그인 상태로 앱 진입
```

### 로그인

```text
이메일·비밀번호 입력
→ users 조회
→ scrypt 검증
→ active 상태 확인
→ last_login_at 갱신
→ sessions 생성
→ HttpOnly 쿠키 설정
```

이메일이 없거나 비밀번호가 틀렸거나 계정이 비활성인 경우 동일한 외부 오류 메시지를 사용한다.

### 비밀번호 변경

```text
현재 비밀번호 재검증
→ 새 비밀번호 8~128자 검사
→ 새 scrypt 해시 저장
→ password_changed_at 갱신
→ 다른 세션 삭제
```

## 6. API

| Method | 경로               | 기능                         |
| ------ | ------------------ | ---------------------------- |
| POST   | `/api/auth/signup` | 일반 사용자 가입과 세션 생성 |
| POST   | `/api/auth/login`  | DB 로그인과 세션 생성        |
| POST   | `/api/auth/logout` | 현재 세션 삭제               |
| GET    | `/api/me`          | 현재 사용자 조회             |
| PATCH  | `/api/me`          | 이름·연락처 수정             |
| PATCH  | `/api/me/password` | 비밀번호 변경                |

로그인·회원가입 응답은 공개 사용자 정보와 세션 만료 시각만 반환한다. 원문 세션 토큰은 JSON에 포함하지 않는다.

## 7. 오류와 요청 제한

| 상태 | 의미                                         |
| ---- | -------------------------------------------- |
| 400  | 이름·이메일·비밀번호 형식 오류               |
| 401  | 로그인 실패, 세션 만료, 현재 비밀번호 불일치 |
| 403  | 쿠키 변경 요청 헤더 오류                     |
| 409  | 이메일 중복                                  |
| 429  | 로그인·회원가입 요청 제한 초과               |

전체 API 제한과 별도로 로그인은 15분당 실패 10회, 회원가입은 시간당 5회로 제한한다.

## 8. 검증 시나리오

- 일반 사용자 가입과 자동 로그인
- 이메일 대소문자 중복 차단
- `role=user` 강제
- 7자 이하·129자 이상 비밀번호 거부
- 평문 비밀번호 미저장
- 기존 개발 해시 로그인과 자동 재해시
- HttpOnly·SameSite 쿠키
- 쿠키 변경 요청의 CSRF 헤더
- 로그아웃 후 세션 폐기
- 현재 비밀번호 오류 거부
- 변경 후 기존 비밀번호 거부
- 비밀번호 변경 후 다른 세션 폐기
- suspended 사용자 로그인·기존 세션 거부

테스트는 `server/app.test.js`에 있다. 현재 WSL1 환경에서는 Windows Node 실행이 불가능하므로 최신 전체 실행은 Windows PowerShell 또는 WSL2에서 `npm run check`로 확인한다.

## 9. 참고 기준

- [NIST SP 800-63B](https://pages.nist.gov/800-63-4/sp800-63b.html)
- [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
- [OWASP Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)
- [OWASP CSRF Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)
- [MDN Set-Cookie](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie)
