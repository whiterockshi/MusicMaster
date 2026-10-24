# ベータ6：LAN HTTPでの開始エラーとiPhone接続案内

## 依頼と原因

音声回答が選べない、crypto.randomUUID is not a function、iPhoneで開く方法が不明というフィードバックに対応。LANのHTTPは安全なコンテキストではないため、音声認識を有効にできずrandomUUIDも存在しない。音声要件を迂回せず、ボタン回答の互換性と接続案内を改善した。

## 変更

- src/id.ts: ネイティブUUID、ない場合はgetRandomValuesからUUID v4を生成。暗号学的乱数がない場合は日本語エラー。mainのセッション生成へ組み込む。
- 設定画面: 利用できない理由・HTTP/HTTPS・isSecureContextを表示。非対応時は音声ラジオを無効表示、PC Local/iPhone HTTPSの手順を案内。
- vite.config.mjsとdev:https: 明示的なHTTPSモードだけローカルPEMを読み、5173で起動。証明書欠如はガイド付きエラー。.certs/と秘密鍵配信を拒否。通常HTTPとビルド設定を維持。
- docs/IPHONE_HTTPS.md: WSL mkcert、Windows NAT転送、Private/LocalSubnet限定ファイアウォール、公開CAだけの一時HTTP配布、iPhoneのインストール/全面的信頼、HTTPS再起動と後片付け。接続元変更での保存領域分離とJSON移行も説明。
- PLANとREADMEを更新。証明書・秘密鍵・一時配布ファイルはGit対象外。

## 検証

- npm test: 50件成功（UUID互換性6件を追加）。
- npm run build: 型チェック・本番ビルド成功。
- PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:e2e -- tests/e2e/beta6.spec.ts: 10件成功。実際に非セキュアなHTTPオリジンとして扱われるURLをテスト経路で配信し、randomUUIDがundefinedでもLv1回答・保存・再読込が成功すること、音声無効理由・接続情報が表示されることを確認。既存の音声同意・採点・FIFO等も回帰確認。音声APIはモック。
- 一時的なローカル自己署名証明書でHTTPSモードを起動。curlで証明書を検証して200応答、Chromiumでページ表示・isSecureContext=true・randomUUIDが関数であることを確認。Chromiumのみ証明書エラー無視を使うテストで、iPhoneの信頼導入の代用とはしない。
- /.certs/dev-key.pemと/@fs/.../.certs/dev-key.pemの両方が403になることを確認。テストのサーバーを停止し証明書を削除。
- 証明書なしでdev:httpsが手順付きエラー終了することを確認。
- iPhone SE相当375pxの設定画面スクリーンショットを目視確認（test-results/beta6-http-settings.png、Git対象外）。
- 関連箇所を別エージェントでもレビュー。mkcert公式手順、Microsoft WSLネットワーク、Appleの証明書信頼設定を参照。

## 実機で残る確認

Windowsの接続設定・iPhoneの証明書信頼・実際の音声認識精度・録音併用。ユーザー側の端末で確認が必要。今回、実マイク、OSの信頼設定変更、外部公開、音声送信は行っていない。
