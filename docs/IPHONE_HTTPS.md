# iPhone SafariからWSLのベータ6を開く

最初の確認だけなら、PCで `npm run dev` を実行し、ターミナルの **Local** アドレスをChrome / Edge / Safariで開くのが簡単です。**NetworkのHTTPアドレスでは音声回答を使えません。** Windows側のブラウザでも通常はWSLのLocalアドレスに接続できます。

iPhoneではHTTPSが必要です。以下は**自宅の同じWi-Fi内だけで確認する方法**です。外部ホスティングやトンネルは使いません。Windows + WSL2（Ubuntu）を想定しています。PCの証明書作成、iPhoneでの証明書の信頼、WindowsからWSLへの接続設定を一度行います。

## 0. バックアップと接続の準備

- 今のアプリのサポートでJSONバックアップを保存してください。HTTP→HTTPS、PC→iPhone、IPやポートの変更では保存領域が別になり、履歴は自動移動しません。新しい接続先でJSONを復元できます。録音はJSONに含まれません。
- WindowsとiPhoneを同じ信頼できるWi-Fiへ接続してください。ゲストWi-Fiでは端末同士の通信を禁止している場合があります。
- PCで実行中の開発サーバーは `Ctrl+C` で止めます。
- 以下ではPCのWi-Fi IPv4を `192.168.1.20` としています。**必ず自分のIPに置き換えてください。** iPhoneのIPやWSLのIPとは別です。

## 1. WindowsのWi-Fi IPv4を調べる

WindowsのPowerShellで：

```powershell
ipconfig
```

「Wireless LAN adapter Wi-Fi」（名称は環境により異なる）の「IPv4 Address」を控えます。EthernetでPCを接続している場合は、そのLAN側IPv4を使います。

## 2. WSLでローカル証明書を作る

WSLのプロジェクトディレクトリで実行します。`sudo` はLinux側のパスワードが必要です。証明書ツールを導入してローカル認証局を作成します。

```bash
cd ~/AppDev/MusicMaster
sudo apt update
sudo apt install mkcert libnss3-tools openssl
mkcert -install
mkdir -p .certs
mkcert -key-file .certs/dev-key.pem -cert-file .certs/dev-cert.pem localhost 127.0.0.1 192.168.1.20
```

作業ディレクトリが `~/AppDev/MusicSensor` の場合は読み替えてください。`mkcert -install` だけではiPhoneはまだ証明書を信頼しません。次の手順も必要です。証明書と秘密鍵はGitの対象外です。

`mkcert` パッケージが見つからない場合は [mkcertの公式Linux導入手順](https://github.com/FiloSottile/mkcert#linux) を確認してください。

## 3. WindowsからWSLへの接続を通す

WSL2の標準NAT構成向けの設定です。**管理者として開いたWindows PowerShell**で：

```powershell
$musicWslIp = ((wsl.exe hostname -I).Trim() -split '\s+')[0]
netsh interface portproxy add v4tov4 listenaddress=0.0.0.0 listenport=5173 connectaddress=$musicWslIp connectport=5173
New-NetFirewallRule -DisplayName "MusicSensor LAN test" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 5173 -Profile Private -RemoteAddress LocalSubnet
```

複数のWSLディストリビューションがある場合は `wsl.exe -d Ubuntu hostname -I` など対象を指定します。Wi-FiのWindowsネットワークプロファイルは、自宅など信頼できるネットワークで「プライベート」にしてください。ファイアウォールを全体で無効にする必要はありません。

WSLの再起動でIPが変わった場合、最初の2行を実行し直します。ミラーネットワーク等の別構成でつながらない場合は、構成に合った設定が必要です。

## 4. iPhoneに開発用認証局の証明書を渡す

配布するのは**公開証明書1ファイルだけ**です。`rootCA-key.pem`、`.certs/dev-key.pem`、認証局フォルダー全体を共有しないでください。

WSLのプロジェクトディレクトリで：

```bash
mkdir -p public
openssl x509 -in "$(mkcert -CAROOT)/rootCA.pem" -outform DER -out public/musicsensor-dev-ca.cer
npm run dev -- --port 5173 --strictPort
```

iPhoneのSafariで、`http://192.168.1.20:5173/musicsensor-dev-ca.cer` を開きます（ここだけ証明書受け取り用のHTTPです）。これは自分で作成した証明書だけを使う手順です。

1. プロファイルのダウンロードを許可します。
2. iPhoneの「設定」→「ダウンロード済みのプロファイル」からインストールします。見つからない場合は「一般」→「VPNとデバイス管理」を確認します。
3. 「設定」→「一般」→「情報」→「証明書信頼設定」で、作成した **mkcertの認証局**の「ルート証明書を全面的に信頼する」をONにします。

この認証局を信頼すると、その認証局が発行した証明書を端末が信用するようになります。自分が作った認証局にだけ設定してください。単にSafariの証明書警告を通過する方法では音声入力できるとは限りません。

インストール後、WSLで `Ctrl+C` を押してサーバーを止め、配布ファイルを消します。

```bash
rm public/musicsensor-dev-ca.cer
npm run dev:https
```

## 5. iPhoneでアプリを開く

iPhoneのSafariで **`https://192.168.1.20:5173`** を開きます。`http` ではなく `https` です。iPhoneの `localhost` はiPhone自身を指すので使いません。

1. 証明書の警告なしで開けるか確認します。
2. サポート→設定→「iPhone・PCで音声回答を使うには」の接続情報で「HTTPS / 安全なコンテキスト：はい」を確認します。
3. 「音声回答（日本語）」を選び、利用説明に同意します。
4. 「音声入力をテスト」を押して、マイク・音声認識の許可後に「ド」などと発話します。

音声認識はAppleなどブラウザ・OS提供元のサービスへ音声を送る場合があります。**ローカルHTTPSはアプリ配信を同じWi-Fi内に収める方法で、音声認識を端末内だけにする設定ではありません。** 録音は別同意で初期OFFです。HTTPSでも認識APIが利用できなければ、その理由をアプリに表示します。

Safariで認識が使えない場合は、iPhoneのマイク許可、Siri/音声入力の設定、スクリーンタイム等の制限を確認してください。OS・管理設定によって利用できない場合もあります。実機での認識精度・録音併用はこれからの確認対象です。まずは室内で本体マイクだけで試してください。

## つながらないとき

- **ページ自体が開かない：** PCのIPv4、同じWi-Fi、WSLサーバー起動、Windowsのポート転送・プライベートプロファイル、端末分離を確認。
- **証明書の警告：** 作成時のIPとURLが一致しているか、iPhoneでプロファイルのインストールと全面的な信頼の両方を行ったか確認。PCのIPが変わったら手順2の最後のコマンドで証明書を再発行し、サーバーを再起動します。同じ認証局ならiPhoneへの再インストールは不要です。
- **音声の選択ができない：** `https` で開いているか、アプリの接続情報と非対応理由を確認。PCでは `npm run dev` のLocalアドレスでも試せます。
- **履歴がない：** 別の接続元・別の端末の保存領域です。元の画面から保存したJSONを復元します。復元後は音声利用に再同意が必要です。
- **5173が使用中：** 実行中の開発サーバーを止めてから再実行してください。HTTPSモードはURL・証明書・転送設定を一致させるため別のポートへ自動移動しません。

## テスト終了後

サーバーは `Ctrl+C` で停止できます。接続設定を残さない場合は管理者PowerShellで次を実行します。

```powershell
netsh interface portproxy delete v4tov4 listenaddress=0.0.0.0 listenport=5173
Remove-NetFirewallRule -DisplayName "MusicSensor LAN test"
```

不要になった開発用認証局はiPhoneの「設定」→「一般」→「VPNとデバイス管理」から削除できます。ローカル証明書は開発専用です。正式公開はベータ8で別途行います。

参考：[mkcertのiOS手順](https://github.com/FiloSottile/mkcert#mobile-devices)、[MicrosoftのWSLネットワーク資料](https://learn.microsoft.com/en-us/windows/wsl/networking)、[Appleの証明書信頼設定](https://support.apple.com/ja-jp/102390)。
