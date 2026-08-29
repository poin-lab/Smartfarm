# GREEN LINK 문서 안내

문서는 현재 구현과 향후 목표를 섞지 않도록 다음 기준으로 나눈다.

| 문서                                                              | 기준 시점   | 내용                                                        |
| ----------------------------------------------------------------- | ----------- | ----------------------------------------------------------- |
| [FEATURES.md](./FEATURES.md)                                      | 현재        | 기능별 화면, API 호출, 저장 데이터, 구현 상태               |
| [API.md](./API.md)                                                | 현재        | 실제 Express API 전체 목록과 인증 방식                      |
| [DATABASE.md](./DATABASE.md)                                      | 현재        | SQLite 테이블, 관계, 트랜잭션과 현재 한계                   |
| [LAN_ACCESS.md](./LAN_ACCESS.md)                                  | 현재        | 서버 PC 한 대에서 스마트폰·노트북 접속시키는 LAN 실행 방식  |
| [PUBLIC_ACCESS.md](./PUBLIC_ACCESS.md)                            | 현재        | 다른 와이파이·모바일 데이터에서도 접속시키는 공개 터널 방식 |
| [EXTERNAL_TRADING.md](./EXTERNAL_TRADING.md)                      | 현재/미래   | 현재 provider 경계와 증권사·외부 거래 시스템 확장 기준      |
| [USER_AUTH_DESIGN.md](../USER_AUTH_DESIGN.md)                     | 현재        | 일반 사용자 회원가입·로그인·세션 상세                       |
| [DATABASE_BLOCKCHAIN_DESIGN.md](../DATABASE_BLOCKCHAIN_DESIGN.md) | 현재/목표   | 농장주 발행, 주문·체결·원장 구현 현황과 블록체인 목표 구조  |
| [IOT_INTEGRATION.md](./IOT_INTEGRATION.md)                        | 선택/후순위 | 센서·제어기·카메라 장비 연동                                |
| [PUBLIC_CHAIN.md](./PUBLIC_CHAIN.md)                              | 선택/후순위 | EVM 퍼블릭 체인 하이브리드 운영                             |
| [RELEASE_NOTES.md](../RELEASE_NOTES.md)                           | 과거 기록   | `1.0.0-rc.2` 시점 검증 기록                                 |

## 문서 해석 원칙

- “현재” 문서는 지금 코드와 SQLite에서 실제 동작하는 내용이다.
- “목표” 문서는 실서비스·외부 연동까지 포함하며, 현재 구현 여부는 각 문서의 상태 표를 기준으로 본다.
- 브라우저는 HttpOnly 쿠키로 인증한다. 문서의 Bearer 인증은 테스트·호환 경로다.
- SQLite는 별도 DB 서버가 아니라 API 프로세스 안에서 열리는 단일 파일 DB다.
- 외부 사업자에게 SQLite 파일이나 테이블을 직접 공개하지 않는다. 연동은 API와 이벤트로 한다.

## 현재 우선순위

1. 일반 사용자와 로그인
2. 내부 DB 기반 주문·구매·판매·지갑
3. 농장주 발행과 판매 물량 원장 정리
4. 외부 거래 시스템용 provider/API 경계
5. 관리자 확장
6. IoT와 퍼블릭 체인
