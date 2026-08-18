#!/bin/sh
if [ "$OCPP_VERSION" = "two" ]; then
    apt-get update && apt-get install -y sqlite3
    sqlite3 /ext/dist/share/everest/modules/OCPP201/device_model_storage.db \
            "UPDATE VARIABLE_ATTRIBUTE \
            SET value = '[{\"configurationSlot\": 1, \"connectionData\": {\"messageTimeout\": 30, \"ocppCsmsUrl\": \"$EVEREST_TARGET_URL\", \"ocppInterface\": \"Wired0\", \"ocppTransport\": \"JSON\", \"ocppVersion\": \"OCPP20\", \"securityProfile\": 2}},{\"configurationSlot\": 2, \"connectionData\": {\"messageTimeout\": 30, \"ocppCsmsUrl\": \"$EVEREST_TARGET_URL\", \"ocppInterface\": \"Wired0\", \"ocppTransport\": \"JSON\", \"ocppVersion\": \"OCPP20\", \"securityProfile\": 2}}]' \
            WHERE \
            variable_Id IN ( \
            SELECT id FROM VARIABLE \
            WHERE name = 'NetworkConnectionProfiles' \
            );"
fi

/entrypoint.sh
http-server /tmp/everest_ocpp_logs -p 8888 &

if [ "$OCPP_VERSION" = "one" ]; then
    OCPP_16_CONFIG_PATH="/ext/dist/share/everest/modules/OCPP/config-docker.json"

    # CentralSystemURI must be scheme-less; libocpp derives ws/wss from
    # SecurityProfile (1 = ws, 2 = wss with basic auth).
    case "$EVEREST_TARGET_URL" in
        wss://*)
            OCPP_16_TARGET_URL="${EVEREST_TARGET_URL#wss://}"
            OCPP_16_SECURITY_PROFILE=2
            OCPP_16_DEFAULT_PORT=443
            ;;
        *)
            OCPP_16_TARGET_URL="${EVEREST_TARGET_URL#ws://}"
            OCPP_16_SECURITY_PROFILE=1
            OCPP_16_DEFAULT_PORT=80
            ;;
    esac

    # libocpp falls back to port 80 when the URI carries no explicit port, which
    # for wss hits the plain-HTTP entrypoint and only ever gets a 301 redirect.
    OCPP_16_AUTHORITY="${OCPP_16_TARGET_URL%%/*}"
    case "$OCPP_16_AUTHORITY" in
        *:*) ;;
        *)
            OCPP_16_TARGET_URL="${OCPP_16_AUTHORITY}:${OCPP_16_DEFAULT_PORT}${OCPP_16_TARGET_URL#"$OCPP_16_AUTHORITY"}"
            ;;
    esac

    node -e '
        const fs = require("fs");
        const [path, url, profile] = process.argv.slice(1);
        const cfg = JSON.parse(fs.readFileSync(path, "utf8"));
        cfg.Internal.CentralSystemURI = url;
        // Traefik serves an RSA certificate, while the libocpp v16 default TLS 1.2
        // cipher list only offers ECDSA suites, so ECDHE-RSA must be added or the
        // handshake fails whenever TLS 1.3 is unavailable.
        cfg.Internal.SupportedCiphers12 = [
            "ECDHE-ECDSA-AES128-GCM-SHA256",
            "ECDHE-ECDSA-AES256-GCM-SHA384",
            "ECDHE-RSA-AES128-GCM-SHA256",
            "ECDHE-RSA-AES256-GCM-SHA384",
            "AES128-GCM-SHA256",
            "AES256-GCM-SHA384"
        ];
        // Needed to validate the ACME-issued chain against the system CA store.
        cfg.Internal.UseSslDefaultVerifyPaths = true;
        cfg.Security = cfg.Security || {};
        cfg.Security.SecurityProfile = Number(profile);
        fs.writeFileSync(path, JSON.stringify(cfg, null, 2));
    ' "$OCPP_16_CONFIG_PATH" "$OCPP_16_TARGET_URL" "$OCPP_16_SECURITY_PROFILE"

    echo "[start.sh] OCPP 1.6 CentralSystemURI=$OCPP_16_TARGET_URL SecurityProfile=$OCPP_16_SECURITY_PROFILE"

    chmod +x /ext/build/run-scripts/run-sil-ocpp.sh
    /ext/build/run-scripts/run-sil-ocpp.sh
else
    rm /ext/dist/share/everest/modules/OCPP201/component_config/custom/EVSE_2.json
    rm /ext/dist/share/everest/modules/OCPP201/component_config/custom/Connector_2_1.json
    chmod +x /ext/build/run-scripts/run-sil-ocpp201-pnc.sh
    /ext/build/run-scripts/run-sil-ocpp201-pnc.sh
fi