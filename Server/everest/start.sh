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
    OCPP_16_TARGET_URL="${EVEREST_TARGET_URL#wss://}"
    OCPP_16_CONFIG_PATH="/ext/dist/share/everest/modules/OCPP/config-docker.json"

    chmod +x /ext/build/run-scripts/run-sil-ocpp.sh
    sed -i \
        -e "s|127.0.0.1:8180/steve/websocket/CentralSystemService/|${OCPP_16_TARGET_URL}|" \
        -e 's|"SecurityProfile": 1|"SecurityProfile": 2|' \
        "$OCPP_16_CONFIG_PATH"
    /ext/build/run-scripts/run-sil-ocpp.sh
else
    rm /ext/dist/share/everest/modules/OCPP201/component_config/custom/EVSE_2.json
    rm /ext/dist/share/everest/modules/OCPP201/component_config/custom/Connector_2_1.json
    chmod +x /ext/build/run-scripts/run-sil-ocpp201-pnc.sh
    /ext/build/run-scripts/run-sil-ocpp201-pnc.sh
fi