/* eslint-disable */
/////////////////////////////////////////////////////////////
//
// pgAdmin 4 - PostgreSQL Tools
// AI INTEGRATION FINAL VERSION (SIDEBAR + AUTO EXECUTE)
//
//////////////////////////////////////////////////////////////
import React, {useCallback, useRef, useMemo, useState, useEffect} from 'react';
import _ from 'lodash';
import Layout, { LayoutDocker, LAYOUT_EVENTS } from '../../../../../static/js/helpers/Layout';
import EventBus from '../../../../../static/js/helpers/EventBus';
import Query from './sections/Query';
import { ConnectionBar } from './sections/ConnectionBar';
import { ResultSet } from './sections/ResultSet';
import { StatusBar } from './sections/StatusBar';
import { MainToolBar } from './sections/MainToolBar';
import { Messages } from './sections/Messages';
import getApiInstance, {callFetch, parseApiError} from '../../../../../static/js/api_instance';
import url_for from 'sources/url_for';
import { PANELS, QUERY_TOOL_EVENTS, CONNECTION_STATUS, MAX_QUERY_LENGTH, OS_EOL } from './QueryToolConstants';
import { useBeforeUnload, useInterval } from '../../../../../static/js/custom_hooks';
import { Box } from '@mui/material'; 
import { getDatabaseLabel, getTitle, setQueryToolDockerTitle } from '../sqleditor_title';
import gettext from 'sources/gettext';
import NewConnectionDialog from './dialogs/NewConnectionDialog';
import { evalFunc } from '../../../../../static/js/utils';
import { Notifications } from './sections/Notifications';
import MacrosDialog from './dialogs/MacrosDialog';
import FilterDialog from './dialogs/FilterDialog';
import { QueryHistory } from './sections/QueryHistory';
import * as showQueryTool from '../show_query_tool';
import * as commonUtils from 'sources/utils';
import * as Kerberos from 'pgadmin.authenticate.kerberos';
import PropTypes from 'prop-types';
import { retrieveNodeName } from '../show_view_data';
import { useModal } from '../../../../../static/js/helpers/ModalProvider';
import usePreferences from '../../../../../preferences/static/js/store';
import { useApplicationState } from '../../../../../settings/static/ApplicationStateProvider';
import { connectServer, connectServerModal } from './connectServer';
import { FileManagerUtils  } from '../../../../../misc/file_manager/static/js/components/FileManager';

export const QueryToolContext = React.createContext();
export const QueryToolConnectionContext = React.createContext();
export const QueryToolEventsContext = React.createContext();

// --- AYARLAR ---
const COOLDOWN_MS = 2000; // Spam Koruması (2 saniye)

function fetchConnectionStatus(api, transId) {
  return api.get(url_for('sqleditor.connection_status', {trans_id: transId}));
}

function initConnection(api, params, passdata) {
  return api.post(url_for('NODE-server.connect_id', params), passdata);
}

export function getRandomName(existingNames) {
  const maxNumber = existingNames.reduce((max, name) => {
    const match = name.match(/\d+$/); 
    if (match) {
      const number = parseInt(match[0], 10);
      return number > max ? number : max;
    }
    return max;
  }, 0);

  const newName = `Macro ${maxNumber + 1}`;
  return newName;
}

function setPanelTitle(docker, panelId, title, qtState, dirty=false) {
  if(qtState.current_file) {
    title = qtState.current_file.split('\\').pop().split('/').pop();
  } else if (!qtState.is_new_tab && !title) {
    const internal = docker.getInternalAttrs(panelId);
    title = internal.title;
    if(internal.isDirty) {
      title = title.slice(0, -1);
    }
  } else {
    title = title ?? qtState.params.title;
  }

  title = title + (dirty ? '*': '');
  if (qtState.is_new_tab) {
    window.document.title = title;
  } else {
    docker.setInternalAttrs(panelId, {
      isDirty: dirty,
      fileName: qtState.current_file
    });
    setQueryToolDockerTitle(docker, panelId, true, title, qtState.current_file);
  }
}

const FIXED_PREF = {
  indent: {
    'control': false, 'shift': false, 'alt': false,
    'key': { 'key_code': 9, 'char': 'Tab' },
  },
  unindent: {
    'control': false, 'shift': true, 'alt': false,
    'key': { 'key_code': 9, 'char': 'Tab' },
  },
};

export default function QueryToolComponent({params, pgWindow, pgAdmin, selectedNodeInfo, qtPanelDocker, qtPanelId, eventBusObj}) {
  const containerRef = React.useRef(null);
  const preferencesStore = usePreferences();
  
  // --- AI STATE ---
  const [showAI, setShowAI] = useState(false); // Varsayılan kapalı olsun, butona basınca açılsın
  const [userPrompt, setUserPrompt] = useState('');
  const [aiResponse, setAiResponse] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [aiProvider, setAiProvider] = useState('ollama'); // Varsayılan yerel model
  const [apiKey, setApiKey] = useState(localStorage.getItem('gemini_api_key') || '');
  
  const lastRequestRef = useRef(0);
  const aiCacheRef = useRef({});

  const [qtState, setQtState] = useState({
    preferences: {
      browser: preferencesStore.getPreferencesForModule('browser'),
      sqleditor: {...preferencesStore.getPreferencesForModule('sqleditor'), ...FIXED_PREF},
      graphs: preferencesStore.getPreferencesForModule('graphs'),
      misc: preferencesStore.getPreferencesForModule('misc'),
      editor: preferencesStore.getPreferencesForModule('editor'),
    },
    is_new_tab: window.location == window.parent?.location,
    is_visible: true,
    current_file: null,
    obtaining_conn: true,
    connected: false,
    connected_once: false,
    connection_status: null,
    connection_status_msg: '',
    server_cursor: preferencesStore.getPreferencesForModule('sqleditor').server_cursor === true,
    params: {
      ...params,
      title: _.unescape(params.title),
      is_query_tool: params.is_query_tool == 'true',
      node_name: retrieveNodeName(selectedNodeInfo),
      dbname: _.unescape(params.database_name) || getDatabaseLabel(selectedNodeInfo),
      server_cursor: preferencesStore.getPreferencesForModule('sqleditor').server_cursor === true,
    },
    connection_list: [{
      sgid: params.sgid,
      sid: params.sid,
      did: params.did,
      user: _.unescape(params.user),
      role: _.unescape(params.role),
      title: _.unescape(params.title),
      fgcolor: params.fgcolor,
      bgcolor: params.bgcolor,
      conn_title: getTitle(
        pgAdmin, null, selectedNodeInfo, true, _.unescape(params.server_name), _.unescape(params.database_name) || getDatabaseLabel(selectedNodeInfo),
        _.unescape(params.role) || _.unescape(params.user), params.is_query_tool == 'true'),
      server_name: _.unescape(params.server_name),
      database_name: _.unescape(params.database_name) || getDatabaseLabel(selectedNodeInfo),
      is_selected: true,
    }],
    editor_disabled:true,
    eol:OS_EOL
  });
  const [selectedText, setSelectedText] = useState('');
  
  const api = useMemo(()=>getApiInstance(), []); // API Instance'ı burada tanımladık

  // --- KODU EDİTÖRE AKTAR VE ÇALIŞTIR ---
  const handleApplyToEditor = () => {
    if (!aiResponse) return;
    // 1. Kodu yapıştır
    eventBus.current.fireEvent(QUERY_TOOL_EVENTS.EDITOR_SET_SQL, aiResponse);
    
    // 2. Kodu Çalıştır (Azıcık bekle ki kod yerine otursun)
    setTimeout(() => {
        eventBus.current.fireEvent(QUERY_TOOL_EVENTS.TRIGGER_EXECUTION);
    }, 300);
  };

  // --- AI LOGIC ---
  const handleGenerateSQL = async (action = 'generate', isRetry = false) => {
    if (isLoading && !isRetry) return;

    // Gemini seçiliyse API Key kontrolü
    if (aiProvider === 'gemini' && !apiKey) {
        alert("Gemini için API Key giriniz!");
        return;
    }

    // Spam koruması
    const now = Date.now();
    if (!isRetry && (now - lastRequestRef.current < COOLDOWN_MS)) {
         setAiResponse("⏳ Çok hızlı işlem yapıyorsunuz, lütfen bekleyin.");
         return;
    }

    // Kullanıcının yazdığı veya seçtiği kod
    let payloadText = userPrompt; 
    if (!payloadText && selectedText) payloadText = selectedText;

    if (!payloadText) {
        alert("Lütfen bir soru yazın veya editörden kod seçin!");
        return;
    }

    // --- VERİ ÇEKME MANTIĞI (Sadece Analyze modunda çalışır) ---
    let collectedData = "";
    if (action === 'analyze') {
        try {
            // pgAdmin'in kullandığı SlickGrid hücrelerini yakala
            const headerCells = document.querySelectorAll('.slick-header-column');
            const dataRows = document.querySelectorAll('.slick-row');
            
            let headers = Array.from(headerCells).map(h => h.innerText).filter(t => t !== "").join(" | ");
            let rows = [];
            
            // Performans için sadece ilk 15 satırı al
            dataRows.forEach((row, index) => {
                if (index < 15) {
                    const cells = Array.from(row.querySelectorAll('.slick-cell'))
                                       .map(c => c.innerText)
                                       .join(" | ");
                    if(cells.length > 2) rows.push(cells);
                }
            });

            if (headers && rows.length > 0) {
                collectedData = `SÜTUNLAR: ${headers}\nVERİLER:\n${rows.join("\n")}`;
            }
        } catch (e) {
            console.warn("Tablo verisi okunamadı, sadece SQL yorumlanacak.", e);
        }
    }

    setIsLoading(true);
    if (!isRetry) setAiResponse(`${aiProvider.toUpperCase()} analiz ediyor...`);
    
    if(aiProvider === 'gemini') localStorage.setItem('gemini_api_key', apiKey);
    lastRequestRef.current = Date.now();

    try {
        const res = await api.post(url_for('sqleditor.generate_sql'), {
            prompt: payloadText,     // Kullanıcının sorusu veya SQL kodu
            table_data: collectedData, // Tablodan çekilen gerçek veriler
            action: action,          // 'generate', 'fix', 'optimize', 'analyze'
            provider: aiProvider,
            trans_id: qtState.params.trans_id,
            api_key: apiKey
        });

        const data = res.data;

        // Kota dolum kontrolü
        if (data.retry_after) {
            const waitTime = Math.ceil(data.retry_after);
            setAiResponse(`⚠️ Kota dolu. ${waitTime} saniye sonra denenecek...`);
            setTimeout(() => { handleGenerateSQL(action, true); }, waitTime * 1000);
            return;
        }

        if (data.success === 1) {
            setAiResponse(data.data);
        } else {
            setAiResponse("Hata: " + (data.errormsg || "Bilinmeyen hata"));
        }
    } catch (error) {
        setAiResponse("Bağlantı Hatası: " + (error.message || "Sunucuya ulaşılamadı."));
    } finally {
        setIsLoading(false);
    }
  };

  const setQtStatePartial = (state)=>{
    setQtState((prev)=>({...prev,...evalFunc(null, state, prev)}));
  };
  const isDirtyRef = useRef(false); 
  const eventBus = useRef(eventBusObj || (new EventBus()));
  const docker = useRef(null);
  
  const modal = useModal();
  const {isSaveToolDataEnabled, getToolContent} = useApplicationState();
  const fmUtilsObj = useMemo(()=>new FileManagerUtils(api, {modal}), []);

  /* Connection status poller */
  let pollTime = qtState.preferences.sqleditor.connection_status_fetch_time > 0
    && !qtState.obtaining_conn && qtState.connected_once && qtState.preferences?.sqleditor?.connection_status ?
    qtState.preferences.sqleditor.connection_status_fetch_time*1000 : -1;
  
  if(qtState.connection_status === CONNECTION_STATUS.TRANSACTION_STATUS_ACTIVE && qtState.connected
      || !qtState.is_visible) {
    pollTime = -1;
  }

  const handleEndOfLineChange = useCallback((e)=>{
    const val = e.value || e;
    const lineSep = val === 'crlf' ? '\r\n' : '\n';
    setQtStatePartial({ eol: val });
    eventBus.current.fireEvent(QUERY_TOOL_EVENTS.CHANGE_EOL, lineSep);
  }, []);

  useInterval(async ()=>{
    try {
      let {data: respData} = await fetchConnectionStatus(api, qtState.params.trans_id);
      if(respData.data) {
        setQtStatePartial({
          connected: true,
          connection_status: respData.data.status,
        });
      } else {
        setQtStatePartial({
          connected: false,
          connection_status: null,
          connection_status_msg: gettext('An unexpected error occurred - ensure you are logged into the application.')
        });
      }
      if(respData.data.notifies) {
        eventBus.current.fireEvent(QUERY_TOOL_EVENTS.PUSH_NOTICE, respData.data.notifies);
      }
    } catch (error) {
      console.error(error);
      setQtStatePartial({
        connected: false,
        connection_status: null,
        connection_status_msg: parseApiError(error),
      });
    }
  }, pollTime);


  let defaultLayout = {
    dockbox: {
      mode: 'vertical',
      children: [
        {
          mode: 'horizontal',
          children: [
            {
              maximizable: true,
              tabs: [
                LayoutDocker.getPanel({id: PANELS.QUERY, title: gettext('Query'), content: <Query  onTextSelect={(text) => setSelectedText(text)} setQtStatePartial={setQtStatePartial}/>}),
                LayoutDocker.getPanel({id: PANELS.HISTORY, title: gettext('Query History'), content: <QueryHistory />}),
              ],
            },
            {
              size: 75,
              maximizable: true,
              tabs: [
                LayoutDocker.getPanel({
                  id: PANELS.SCRATCH, title: gettext('Scratch Pad'),
                  closable: true,
                  content: <textarea style={{
                    border: 0,
                    height: '100%',
                    width: '100%',
                    resize: 'none'
                  }} title={gettext('Scratch Pad')}/>
                }),
              ]
            }
          ]
        },
        {
          mode: 'horizontal',
          children: [
            {
              maximizable: true,
              tabs: [
                LayoutDocker.getPanel({
                  id: PANELS.DATA_OUTPUT, title: gettext('Data Output'), content: <ResultSet />,
                }),
                LayoutDocker.getPanel({
                  id: PANELS.MESSAGES, title: gettext('Messages'), content: <Messages />,
                }),
                LayoutDocker.getPanel({
                  id: PANELS.NOTIFICATIONS, title: gettext('Notifications'), content: <Notifications />,
                }),
              ],
            }
          ]
        },
      ]
    },
  };

  const getSQLScript = () => {
    if (qtState.params.is_query_tool && qtState.params.query_url) {
      api.get(qtState.params.query_url)
        .then((res) => {
          eventBus.current.fireEvent(QUERY_TOOL_EVENTS.EDITOR_SET_SQL, res.data);
          setQtStatePartial({ editor_disabled: false });
        })
        .catch((err) => {
          eventBus.current.fireEvent(QUERY_TOOL_EVENTS.HANDLE_API_ERROR, err);
          setQtStatePartial({ editor_disabled: true });
        });
    } else if (qtState.params.sql_id && qtState.params.restore != 'true') {
      let sqlValue = localStorage.getItem(qtState.params.sql_id);
      localStorage.removeItem(qtState.params.sql_id);
      if (sqlValue) {
        eventBus.current.fireEvent(QUERY_TOOL_EVENTS.EDITOR_SET_SQL, sqlValue);
      }
      setQtStatePartial({ editor_disabled: false });
    } else if (qtState.params.restore == 'true') {
      restoreToolContent();
    } else {
      setQtStatePartial({ editor_disabled: false });
    }
  };

  const restoreToolContent = async () =>{
    let toolContent = await getToolContent(qtState.params.trans_id);
    if(toolContent){
      if (toolContent?.modifiedExternally) {
        toolContent = await fmUtilsObj.warnFileReload(toolContent?.fileName, toolContent.data, '');
      }

      if(toolContent?.loadFile){
        eventBus.current.fireEvent(QUERY_TOOL_EVENTS.LOAD_FILE, toolContent.fileName, params?.storage);
      }else{
        eventBus.current.fireEvent(QUERY_TOOL_EVENTS.EDITOR_SET_SQL, toolContent.data);
        if(toolContent?.fileName)eventBus.current.fireEvent(QUERY_TOOL_EVENTS.LOAD_FILE_DONE, toolContent.fileName, true);
      }
    }
    setQtStatePartial({ editor_disabled: false });
  };

  const initializeQueryTool = (password, explainObject=null, macroSQL='', executeCursor=false, executeServerCursor=false, reexecute=false)=>{
    let selectedConn = _.find(qtState.connection_list, (c)=>c.is_selected);
    let baseUrl = '';
    if(qtState.params.is_query_tool) {
      let endpoint = 'sqleditor.initialize_sqleditor';

      if(qtState.params.did) {
        endpoint = 'sqleditor.initialize_sqleditor_with_did';
      }
      baseUrl = url_for(endpoint, {
        ...selectedConn,
        trans_id: qtState.params.trans_id,
      });
    } else {
      baseUrl = url_for('sqleditor.initialize_viewdata', {
        ...qtState.params,
      });
    }
    eventBus.current.fireEvent(QUERY_TOOL_EVENTS.SERVER_CURSOR, executeServerCursor);
    let requestParams = {
      user: selectedConn.user,
      role: selectedConn.role,
      password: password,
      dbname: selectedConn.database_name
    };
    api.post(baseUrl, qtState.params.is_query_tool ?
      {...requestParams} :
      {sql_filter: qtState.params.sql_filter, server_cursor: qtState.params.server_cursor, ...requestParams})
      .then(()=>{
        setQtStatePartial({
          connected: true,
          connected_once: true,
          obtaining_conn: false,
        });
        if(!qtState.params.is_query_tool || reexecute) {
          eventBus.current.fireEvent(QUERY_TOOL_EVENTS.TRIGGER_EXECUTION, explainObject, macroSQL, executeCursor, executeServerCursor);
          let msg = `${selectedConn['server_name']}/${selectedConn['database_name']} - Database connected`;
          pgAdmin.Browser.notifier.success(_.escape(msg));
        }
        if(qtState.params.fileName){
          eventBus.current.fireEvent(QUERY_TOOL_EVENTS.LOAD_FILE, params.fileName, params.storage);
        }
      }).catch((error)=>{
        if(error.response?.request?.responseText?.search('Ticket expired') !== -1) {
          Kerberos.fetch_ticket()
            .then(()=>{
              initializeQueryTool();
            })
            .catch((kberr)=>{
              setQtStatePartial({
                connected: false,
                obtaining_conn: false,
              });
              eventBus.current.fireEvent(QUERY_TOOL_EVENTS.HANDLE_API_ERROR, kberr);
            });
        } else if(error?.response?.status == 428) {
          connectServerModal(modal, error.response?.data?.result, async (passwordData)=>{
            await connectServer(api, modal, selectedConn.sid, selectedConn.user, passwordData, async ()=>{
              initializeQueryTool();
            });
          }, ()=>{
            setQtStatePartial({
              connected: false,
              obtaining_conn: false,
              connection_status_msg: gettext('Not Connected'),
            });
          });
        } else {
          setQtStatePartial({
            connected: false,
            obtaining_conn: false,
          });
          eventBus.current.fireEvent(QUERY_TOOL_EVENTS.HANDLE_API_ERROR, error, ()=>{});
        }
      });
  };

  const {forceClose} = useBeforeUnload({
    enabled: qtState.preferences.browser.confirm_on_refresh_close,
    isNewTab: qtState.is_new_tab,
    beforeClose: ()=>{
      eventBus.current.fireEvent(QUERY_TOOL_EVENTS.WARN_SAVE_DATA_CLOSE);
    },
    closePanel: ()=>{
      qtPanelDocker.close(qtPanelId, true);
    }
  });

  useEffect(()=>{
    getSQLScript();
    initializeQueryTool();
    eventBus.current.registerListener(QUERY_TOOL_EVENTS.REINIT_QT_CONNECTION, initializeQueryTool);
    eventBus.current.registerListener(QUERY_TOOL_EVENTS.FOCUS_PANEL, (qtPanelId)=>{
      docker.current.focus(qtPanelId);
    });
    eventBus.current.registerListener(QUERY_TOOL_EVENTS.SET_CONNECTION_STATUS, (status)=>{
      setQtStatePartial({connection_status: status});
    });
    eventBus.current.registerListener(QUERY_TOOL_EVENTS.FORCE_CLOSE_PANEL, ()=>{
      forceClose();
    });
    qtPanelDocker.eventBus.registerListener(LAYOUT_EVENTS.CLOSING, (id)=>{
      if(qtPanelId == id) {
        eventBus.current.fireEvent(QUERY_TOOL_EVENTS.WARN_SAVE_DATA_CLOSE);
      }
    });
    qtPanelDocker.eventBus.registerListener(LAYOUT_EVENTS.ACTIVE, _.debounce((currentTabId)=>{
      if(qtPanelId == currentTabId) {
        setQtStatePartial({is_visible: true});
        if(docker.current.isTabVisible(PANELS.QUERY)) {
          docker.current.focus(PANELS.QUERY);
        } else if(docker.current.isTabVisible(PANELS.HISTORY)) {
          docker.current.focus(PANELS.HISTORY);
        }
        eventBus.current.fireEvent(QUERY_TOOL_EVENTS.GOTO_LAST_SCROLL);
      } else {
        setQtStatePartial({is_visible: false});
      }
    }, 100));

    document.addEventListener('visibilitychange', function() {
      if(document.hidden) {
        setQtStatePartial({is_visible: false});
      } else {
        setQtStatePartial({is_visible: true});
      }
    });
  }, []);

  useEffect(() => usePreferences.subscribe(
    state => {
      setQtStatePartial({preferences: {
        browser: state.getPreferencesForModule('browser'),
        sqleditor: {...state.getPreferencesForModule('sqleditor'), ...FIXED_PREF},
        graphs: state.getPreferencesForModule('graphs'),
        misc: state.getPreferencesForModule('misc'),
        editor: state.getPreferencesForModule('editor'),
      }});
    }
  ), []);

  useEffect(()=>{
    const closeConn = ()=>{
      callFetch(
        url_for('sqleditor.close', {
          'trans_id': qtState.params.trans_id,
        }), {
          keepalive: true,
          method: 'DELETE'
        }
      ).then(()=>{/* Success */}).catch((err)=>console.error(err));
    };
    window.addEventListener('unload', closeConn);
    const pushHistory = (h)=>{
      if(h?.query?.length > MAX_QUERY_LENGTH) {
        h = {
          ...h,
          query: gettext(`-- Query text not stored as it exceeds maximum length of ${MAX_QUERY_LENGTH}`)
        };
      }
      api.post(
        url_for('sqleditor.add_query_history', {
          'trans_id': qtState.params.trans_id,
        }),
        JSON.stringify(h),
      ).catch((error)=>{console.error(error);});
    };
    eventBus.current.registerListener(QUERY_TOOL_EVENTS.PUSH_HISTORY, pushHistory);
    return ()=>{
      eventBus.current.deregisterListener(QUERY_TOOL_EVENTS.PUSH_HISTORY, pushHistory);
      window.removeEventListener('unload', closeConn);
    };
  }, [qtState.params.trans_id]);


  const handleApiError = (error, handleParams)=>{
    let selectedConn = _.find(qtState.connection_list, (c)=>c.is_selected);
    if(error.response?.status == 503 && error.response.data?.info == 'CONNECTION_LOST') {
      modal.confirm(
        gettext('Connection Warning'),
        <p>
          <span>{gettext('The application has lost the database connection:')}</span>
          <br/><span>{gettext('⁃ If the connection was idle it may have been forcibly disconnected.')}</span>
          <br/><span>{gettext('⁃ The application server or database server may have been restarted.')}</span>
          <br/><span>{gettext('⁃ The user session may have timed out.')}</span>
          <br />
          <span>{gettext('Do you want to continue and establish a new session')}</span>
        </p>,
        () => handleParams?.connectionLostCallback?.(),
        () => handleParams?.cancelCallback?.(),
        gettext('Continue'),
        gettext('Cancel')
      );
    } else if(handleParams?.checkTransaction && error.response?.data.info == 'DATAGRID_TRANSACTION_REQUIRED') {
      initConnection(api, {
        'gid': selectedConn.sgid,
        'sid': selectedConn.sid,
        'did': selectedConn.did,
        'role': selectedConn.role,
      }).then(()=>{
        initializeQueryTool();
      }).catch((err)=>{
        eventBus.current.fireEvent(QUERY_TOOL_EVENTS.HANDLE_API_ERROR, err);
      });
    } else if(error.response?.status == 403  && error.response?.data.info == 'ACCESS_DENIED') {
      pgAdmin.Browser.notifier.error(error.response.data.errormsg);

    }else if(error?.response?.status == 428) {
      connectServerModal(modal, error.response?.data?.result, async (passwordData)=>{
        await connectServer(api, modal, selectedConn.sid, selectedConn.user, passwordData, async ()=>{
          initializeQueryTool();
        });
      }, ()=>{});
    }else {
      let msg = parseApiError(error);
      eventBus.current.fireEvent(QUERY_TOOL_EVENTS.SET_MESSAGE, msg, true);
      eventBus.current.fireEvent(QUERY_TOOL_EVENTS.FOCUS_PANEL, PANELS.MESSAGES);
    }
  };

  useEffect(()=>{
    const fileDone = (fileName, success=true)=>{
      if(success) {
        setQtStatePartial({
          current_file: fileName
        });
        isDirtyRef.current = false;
        setPanelTitle(qtPanelDocker, qtPanelId, fileName, {...qtState, current_file: fileName}, isDirtyRef.current);

        if(isSaveToolDataEnabled('sqleditor'))eventBus.current.fireEvent(QUERY_TOOL_EVENTS.TRIGGER_SAVE_QUERY_TOOL_DATA);
      }
      eventBus.current.fireEvent(QUERY_TOOL_EVENTS.EDITOR_LAST_FOCUS);
    };
    const events = [
      [QUERY_TOOL_EVENTS.TRIGGER_LOAD_FILE, (openInNewTab=false)=>{
        let fileParams = {
          'supported_types': ['sql', '*'], 
          'dialog_type': 'open_file', 
        };
        if(openInNewTab){
          pgAdmin.Tools.FileManager.show(fileParams, (fileName, storage)=>{
            onNewQueryToolClick(null, fileName, storage);
          }, null, modal, openInNewTab);
        }else{
          pgAdmin.Tools.FileManager.show(fileParams,(fileName, storage)=>{
            eventBus.current.fireEvent(QUERY_TOOL_EVENTS.LOAD_FILE, fileName, storage);
          }, null, modal);
        }
      }],
      [QUERY_TOOL_EVENTS.TRIGGER_SAVE_FILE, (isSaveAs=false)=>{
        if(!isSaveAs && qtState.current_file) {
          eventBus.current.fireEvent(QUERY_TOOL_EVENTS.SAVE_FILE, qtState.current_file);
        } else {
          let fileParams = {
            'supported_types': ['sql', '*'],
            'dialog_type': 'create_file',
            'dialog_title': 'Save File',
            'btn_primary': 'Save',
          };
          pgAdmin.Tools.FileManager.show(fileParams, (fileName)=>{
            eventBus.current.fireEvent(QUERY_TOOL_EVENTS.SAVE_FILE, fileName);
          }, null, modal);
        }
      }],
      [QUERY_TOOL_EVENTS.LOAD_FILE_DONE, fileDone],
      [QUERY_TOOL_EVENTS.SAVE_FILE_DONE, fileDone],
      [QUERY_TOOL_EVENTS.QUERY_CHANGED, (isDirty)=>{
        if(isDirtyRef.current === isDirty) return;
        isDirtyRef.current = isDirty;
        if(qtState.params.is_query_tool) {
          setPanelTitle(qtPanelDocker, qtPanelId, null, qtState, isDirty);
        }
      }],
      [QUERY_TOOL_EVENTS.HANDLE_API_ERROR, handleApiError],
    ];
    events.forEach((e)=>{
      eventBus.current.registerListener(e[0], e[1]);
    });
    return ()=>{
      events.forEach((e)=>{
        eventBus.current.deregisterListener(e[0], e[1]);
      });
    };
  }, [qtState.params, qtState.current_file]);

  useEffect(()=>{
    eventBus.current.fireEvent(QUERY_TOOL_EVENTS.TRIGGER_QUERY_CHANGE);
  }, [qtState.params.title]);


  const updateQueryToolConnection = (connectionData, isNew=false)=>{
    let currSelectedConn = _.find(qtState.connection_list, (c)=>c.is_selected);
    let currConnected = qtState.connected;
    const selectConn = (newConnData, connected=false, obtainingConn=true)=>{
      setQtStatePartial((prevQtState)=>{
        let newConnList = [...prevQtState.connection_list];
        if(isNew) {
          newConnList.push(newConnData);
        }
        for (const connItem of newConnList) {
          if(newConnData.sid == connItem.sid
            && newConnData.did == connItem.did
            && newConnData.user == connItem.user
            && newConnData.role == connItem.role) {
            connItem.is_selected = true;
          } else {
            connItem.is_selected = false;
          }
        }
        return {
          connection_list: newConnList,
          obtaining_conn: obtainingConn,
          connected: connected,
        };
      });
    };
    if(!isNew) {
      selectConn(connectionData);
    }
    return new Promise((resolve, reject)=>{
      api.post(url_for('sqleditor.update_sqleditor_connection', {
        trans_id: qtState.params.trans_id,
        sgid: connectionData.sgid,
        sid: connectionData.sid,
        did: connectionData.did
      }), connectionData)
        .then(({data: respData})=>{
          if(isNew) {
            selectConn(connectionData);
          }
          setQtStatePartial((prev)=>{
            return {
              params: {
                ...prev.params,
                trans_id: respData.data.trans_id,
                server_name: connectionData.server_name,
                database_name: connectionData.database_name,
                dbname: connectionData.database_name,
                user: connectionData.user,
                sid: connectionData.sid,
                did: connectionData.did,
                title: connectionData.title,
                fgcolor: connectionData.fgcolor,
                bgcolor: connectionData.bgcolor,
              },
              connected: Boolean(respData.data.trans_id),
              obtaining_conn: false,
            };
          });
          setPanelTitle(qtPanelDocker, qtPanelId, connectionData.title, qtState, isDirtyRef.current);
          let msg = `${connectionData['server_name']}/${connectionData['database_name']} - Database connected`;
          pgAdmin.Browser.notifier.success(_.escape(msg));
          resolve();
        })
        .catch((error)=>{
          if(error?.response?.status == 428) {
            connectServerModal(modal, error.response?.data?.result, (passwordData)=>{
              resolve(
                updateQueryToolConnection({
                  ...connectionData,
                  ...passwordData,
                }, isNew)
              );
            }, ()=>{});
          } else {
            selectConn(currSelectedConn, currConnected, false);
            reject(error instanceof Error ? error : Error(gettext('Something went wrong')));
          }
        });
    });
  };

  const onNewConnClick = useCallback(()=>{
    const onClose = ()=>docker.current.close('new-conn');
    docker.current.openDialog({
      id: 'new-conn',
      title: gettext('Add New Connection'),
      content: <NewConnectionDialog onSave={(_isNew, data)=>{
        return new Promise((resolve, reject)=>{
          let connectionData = {
            sgid: 0,
            sid: data.sid,
            did: data.did,
            user: data.user,
            role: data.role,
            password: data.password,
            title: getTitle(pgAdmin, qtState.preferences.browser, null, false, data.server_name, data.database_name, data.role || data.user, true),
            conn_title: getTitle(pgAdmin, null, null, true, data.server_name, data.database_name, data.role || data.user, true),
            server_name: data.server_name,
            database_name: data.database_name,
            bgcolor: data.bgcolor,
            fgcolor: data.fgcolor,
            is_selected: true,
          };
          let existIdx = _.findIndex(qtState.connection_list, (conn)=>{
            conn.role= conn.role == ''? null :conn.role;
            return(
              conn.sid == connectionData.sid  && conn.database_name == connectionData.database_name
              && conn.user == connectionData.user && conn.role == connectionData.role
            );
          });
          if(existIdx > -1) {
            reject(new Error(gettext('Connection with this configuration already present.')));
            return;
          }
          updateQueryToolConnection(connectionData, true)
            .catch((err)=>{
              reject(err instanceof Error ? err : Error(gettext('Something went wrong')));
            }).then(()=>{
              resolve();
              onClose();
            });
        });
      }}
      onClose={onClose}/>
    });
  }, [qtState.preferences.browser, qtState.connection_list, qtState.params]);

  const onNewQueryToolClick = (event, fileName, storage)=>{
    const transId = commonUtils.getRandomInt(1, 9999999);
    let selectedConn = _.find(qtState.connection_list, (c)=>c.is_selected);
    let parentData = {
      server_group: {
        _id: selectedConn.sgid || 0,
      },
      server: {
        _id: selectedConn.sid,
        server_type: qtState.params.server_type,
      },
      database: {
        _id: selectedConn.did,
        label: selectedConn.database_name,
        _label: selectedConn.database_name,
      },
    };
    const gridUrl = showQueryTool.generateUrl(transId, parentData, null);
    const title = getTitle(pgAdmin, qtState.preferences.browser, null, false, selectedConn.server_name, selectedConn.database_name, selectedConn.role || selectedConn.user);
    showQueryTool.launchQueryTool(pgWindow.pgAdmin.Tools.SQLEditor, transId, gridUrl, title, {
      user: selectedConn.user,
      role: selectedConn.role,
      fileName: fileName,
      storage: storage
    });
  };

  const onManageMacros = useCallback(()=>{
    const onClose = ()=>docker.current.close('manage-macros');
    docker.current.openDialog({
      id: 'manage-macros',
      title: gettext('Manage Macros'),
      content: <MacrosDialog onSave={(newMacros)=>{
        setQtStatePartial((prev)=>{
          return {
            params: {
              ...prev.params,
              macros: newMacros,
            },
          };
        });
      }}
      onClose={onClose}/>
    }, 850, 500);
  }, [qtState.preferences.browser]);

  const onAddToMacros = () => {
    if (selectedText){
      let currMacros = qtState.params.macros;
      const existingNames = currMacros.map(macro => macro.name);
      const newName = getRandomName(existingNames);
      let changed = [{ 'name': newName, 'sql': selectedText }];
      api.put(
        url_for('sqleditor.set_macros', {
          'trans_id': qtState.params.trans_id,
        }),
        { changed: changed }
      ).then(({ data: respData }) => {
          const filteredData = respData.filter(m => Boolean(m.name));
          setQtStatePartial(prev => ({
            ...prev,
            params: {
              ...prev.params,
              macros: filteredData,
            },
          }));
        }).catch(error => { console.error(error); });
    }
    setSelectedText('');
  };

  const onFilterClick = useCallback(()=>{
    const onClose = ()=>docker.current.close('filter-dialog');
    docker.current.openDialog({
      id: 'filter-dialog',
      title: gettext('Sort/Filter options'),
      content: <FilterDialog onSave={()=>{
        onClose();
        eventBus.current.fireEvent(QUERY_TOOL_EVENTS.TRIGGER_EXECUTION);
      }}
      onClose={onClose}/>
    }, 700, 400);
  }, [qtState.preferences.browser]);

  const onResetLayout = useCallback(()=>{
    docker.current?.resetLayout();
    eventBus.current.fireEvent(QUERY_TOOL_EVENTS.FOCUS_PANEL, PANELS.QUERY);
  }, []);

  const queryToolContextValue = React.useMemo(()=>({
    docker: docker.current,
    api: api,
    modal: modal,
    params: qtState.params,
    server_cursor: qtState.server_cursor,
    preferences: qtState.preferences,
    mainContainerRef: containerRef,
    editor_disabled: qtState.editor_disabled,
    eol: qtState.eol,
    connection_list: qtState.connection_list,
    current_file: qtState.current_file,
    toggleQueryTool: () => setQtStatePartial((prev)=>{
      return {
        ...prev,
        params: {
          ...prev.params,
          is_query_tool: true
        }
      };
    }),
    updateTitle: (title) => {
      setPanelTitle(qtPanelDocker, qtPanelId, title, qtState, isDirtyRef.current);
      setQtStatePartial((prev) => {
        let newConnList = [...prev.connection_list];
        newConnList.forEach((conn) => {
          if (conn.sgid == params.sgid && conn.sid == params.sid && conn.did == params.did) {
            conn.title = title;
            conn.conn_title = title;
          }
        });
        return {
          ...prev,
          params: {
            ...prev.params,
            title: title
          },
          connection_list: newConnList,
        };
      });
    },
    updateServerCursor: (state) => {
      setQtStatePartial(state);
    },
  }), [qtState.params, qtState.preferences, containerRef.current, qtState.editor_disabled, qtState.eol,  qtState.current_file, qtState.server_cursor, docker.current]);

  const queryToolConnContextValue = React.useMemo(()=>({
    connected: qtState.connected,
    obtainingConn: qtState.obtaining_conn,
    connectionStatus: qtState.connection_status,
  }), [qtState]);

  return (
    <QueryToolContext.Provider value={queryToolContextValue}>
      <QueryToolConnectionContext.Provider value={queryToolConnContextValue}>
        <QueryToolEventsContext.Provider value={eventBus.current}>
          <Box position="relative" width="100%" height="100%" display="flex" flexDirection="column" flexGrow="1" tabIndex="0" ref={containerRef}>
            <ConnectionBar
              connected={qtState.connected}
              connecting={qtState.obtaining_conn}
              connectionStatus={qtState.connection_status}
              connectionStatusMsg={qtState.connection_status_msg}
              connectionList={qtState.connection_list}
              onConnectionChange={(connectionData)=>updateQueryToolConnection(connectionData)}
              onNewConnClick={onNewConnClick}
              onNewQueryToolClick={onNewQueryToolClick}
              onResetLayout={onResetLayout}
              docker={docker.current}
              containerRef={containerRef}
            />
            
            {/* TOOLBAR VE AI AÇ BUTONU */}
            <div style={{display: 'flex', alignItems: 'center', width: '100%'}}>
                <div style={{flex: 1}}>
                    {React.useMemo(()=>(
                    <MainToolBar
                        containerRef={containerRef}
                        onManageMacros={onManageMacros}
                        onAddToMacros={onAddToMacros}
                        onFilterClick={onFilterClick}
                    />), [containerRef.current, onManageMacros, onFilterClick, onAddToMacros])}
                </div>
                {!showAI && (
                    <button
                        onClick={() => setShowAI(true)}
                        style={{
                            backgroundColor: '#28a745',
                            color: 'white',
                            border: 'none',
                            padding: '5px 15px',
                            marginRight: '10px',
                            borderRadius: '4px',
                            fontWeight: 'bold',
                            cursor: 'pointer',
                            height: '30px',
                            zIndex: 99999
                        }}
                    >
                        🤖 AI AÇ
                    </button>
                )}
            </div>

            <Layout
              getLayoutInstance={(obj)=>docker.current=obj}
              defaultLayout={defaultLayout}
              layoutId="SQLEditor/Layout"
              savedLayout={params.layout}
              resetToTabPanel={PANELS.MESSAGES}
            />
            <StatusBar eol={qtState.eol} handleEndOfLineChange={handleEndOfLineChange} />
            
            {/* AI PANELİ (V6 - HIBRIT SEÇİMLİ - FINAL) */}
            {showAI && (
                <Box sx={{
                    position: 'absolute',
                    right: 0,
                    top: 0,
                    width: '350px',
                    height: '100%',
                    bgcolor: 'background.default',
                    color: 'text.primary',
                    borderLeft: 1,
                    borderColor: 'divider',
                    zIndex: 9999,
                    display: 'flex',
                    flexDirection: 'column',
                    boxShadow: 3
                }}>
                    {/* BAŞLIK */}
                    <Box sx={{
                        p: 1, 
                        borderBottom: 1, 
                        borderColor: 'divider', 
                        bgcolor: 'background.paper',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        flexShrink: 0
                    }}>
                        <h3 style={{margin:0, fontSize:'14px'}}>🤖 AI Asistan (Hibrit)</h3>
                        <button 
                            onClick={() => setShowAI(false)}
                            style={{cursor:'pointer', border:'none', background:'transparent', fontSize:'16px', color:'inherit'}}
                        >✖</button>
                    </Box>

                    {/* İÇERİK GÖVDESİ */}
                    <Box sx={{
                        p: '10px', 
                        flex: 1, 
                        display:'flex', 
                        flexDirection:'column',
                        overflow: 'hidden', 
                        minHeight: 0        
                    }}>
                        
                        <Box sx={{ flexShrink: 0 }}>
                            {/* MODEL SEÇİMİ (DROPDOWN) */}
                            <div style={{marginBottom:'10px'}}>
                                <label style={{fontSize:'12px', fontWeight:'bold', display:'block', marginBottom:'5px'}}>AI Modeli:</label>
                                <select 
                                    value={aiProvider}
                                    onChange={(e) => setAiProvider(e.target.value)}
                                    style={{
                                        width:'100%', padding:'5px', 
                                        border:'1px solid #ccc', borderRadius:'3px',
                                        backgroundColor: '#fff', color: '#000'
                                    }}
                                >
                                    <option value="gemini">🌍 Google Gemini (Cloud)</option>
                                    <option value="ollama">🏠 Ollama (Local - Güvenli qwen2.5-coder)</option>
                                </select>
                            </div>

                            {/* API KEY GİRİŞİ (Sadece Gemini için aktif) */}
                            <div style={{marginBottom:'10px'}}>
                                <label style={{fontSize:'12px', fontWeight:'bold', display:'block', marginBottom:'5px'}}>API Key:</label>
                                <Box component="input"
                                    type="password" 
                                    value={apiKey}
                                    onChange={(e) => setApiKey(e.target.value)}
                                    placeholder={aiProvider === 'ollama' ? "Ollama'da key gerekmez" : "Gemini Key..."}
                                    disabled={aiProvider === 'ollama'} 
                                    sx={{
                                        width:'100%', padding:'5px', border: 1, borderColor: 'divider', 
                                        borderRadius:'3px', bgcolor: aiProvider === 'ollama' ? 'action.disabledBackground' : 'background.paper',
                                        color: 'text.primary'
                                    }}
                                />
                            </div>

                            {/* SORU ALANI */}
                            <Box component="textarea"
                                placeholder="Sorunuzu buraya yazın veya editörden SQL seçip butonlara basın..." 
                                value={userPrompt}
                                onChange={(e) => setUserPrompt(e.target.value)}
                                sx={{
                                    width: '100%', height: '80px', padding: '8px', marginBottom: '10px',
                                    border: 1, borderColor: '#ffffff', borderRadius: '4px',
                                    bgcolor: 'background.paper', color: 'text.primary', resize: 'vertical'
                                }}
                            ></Box>
                            
                            {/* BUTONLAR */}
                            <div style={{display:'flex', gap:'5px', marginBottom:'10px'}}>
                                <button onClick={() => handleGenerateSQL('generate')} disabled={isLoading} title="SQL üretir" style={{flex: 1, padding: '8px', backgroundColor: isLoading ? '#ccc' : '#007bff', color: 'white', border: 'none', borderRadius: '4px', cursor: isLoading ? 'wait' : 'pointer', fontWeight: 'bold', fontSize:'12px'}}>✨ Üret</button>
                                <button onClick={() => handleGenerateSQL('fix')} disabled={isLoading} title="Düzeltir" style={{flex: 1, padding: '8px', backgroundColor: isLoading ? '#ccc' : '#dc3545', color: 'white', border: 'none', borderRadius: '4px', cursor: isLoading ? 'wait' : 'pointer', fontWeight: 'bold', fontSize:'12px'}}>🛠️ Düzelt</button>
                                <button onClick={() => handleGenerateSQL('optimize')} disabled={isLoading} title="Hızlandırır" style={{flex: 1, padding: '8px', backgroundColor: isLoading ? '#ccc' : '#28a745', color: 'white', border: 'none', borderRadius: '4px', cursor: isLoading ? 'wait' : 'pointer', fontWeight: 'bold', fontSize:'12px'}}>🚀 Hızlan</button>
                                <button onClick={() => handleGenerateSQL('analyze')} disabled={isLoading} title="Yorumlar" style={{flex: 1, padding: '8px', backgroundColor: isLoading ? '#ccc' : '#6f42c1', color: 'white', border: 'none', borderRadius: '4px', cursor: isLoading ? 'wait' : 'pointer', fontWeight: 'bold', fontSize:'12px'}}>📊 Yorumla</button>
                            </div>
                        </Box>

                        {/* CEVAP ALANI */}
                        <div style={{marginTop:'15px', display:'flex', flexDirection:'column', flex:1, minHeight:'0px'}}>
                            <strong style={{fontSize:'12px', marginBottom:'5px'}}>Cevap:</strong>
                            <Box component="textarea"
                                readOnly={true}
                                value={aiResponse || "Henüz bir sorgu yok..."}
                                sx={{
                                    flex: 1,            
                                    resize: 'none',    
                                    bgcolor: 'background.paper',
                                    color: 'text.primary',
                                    fontFamily: 'monospace',
                                    border: 1,
                                    borderColor: 'divider',
                                    borderRadius:'4px',
                                    padding:'10px',
                                    fontSize:'12px',
                                    marginBottom: '5px',
                                    '&:focus': { outline: 'none' }
                                }}
                            />
                            {/* KODU EDİTÖRE AKTAR VE ÇALIŞTIR BUTONU */}
                            <button
                                onClick={handleApplyToEditor}
                                disabled={!aiResponse}
                                style={{
                                    width: '100%',
                                    padding: '8px',
                                    backgroundColor: !aiResponse ? '#ccc' : '#28a745', 
                                    color: 'white',
                                    border: 'none',
                                    borderRadius: '4px',
                                    cursor: !aiResponse ? 'default' : 'pointer',
                                    fontWeight: 'bold',
                                    fontSize: '12px',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap:'5px'
                                }}
                            >
                                ▶️ Aktar ve Çalıştır
                            </button>
                        </div>

                    </Box>
                </Box>
            )}
          </Box>
        </QueryToolEventsContext.Provider>
      </QueryToolConnectionContext.Provider>
    </QueryToolContext.Provider>
  );
}

QueryToolComponent.propTypes = {
  params:PropTypes.shape({
    trans_id: PropTypes.number.isRequired,
    sgid: PropTypes.oneOfType([PropTypes.number, PropTypes.string]).isRequired,
    sid: PropTypes.oneOfType([PropTypes.number, PropTypes.string]).isRequired,
    did: PropTypes.oneOfType([PropTypes.number, PropTypes.string]).isRequired,
    server_type: PropTypes.string,
    title: PropTypes.string.isRequired,
    bgcolor: PropTypes.string,
    fgcolor: PropTypes.string,
    is_query_tool: PropTypes.oneOfType([PropTypes.bool, PropTypes.string]).isRequired,
    server_cursor: PropTypes.oneOfType([PropTypes.bool, PropTypes.string]),
    user: PropTypes.string,
    role: PropTypes.string,
    server_name: PropTypes.string,
    database_name: PropTypes.string,
    layout: PropTypes.string,
    fileName: PropTypes.string,
    storage: PropTypes.string,
  }),
  pgWindow: PropTypes.object.isRequired,
  pgAdmin: PropTypes.object.isRequired,
  selectedNodeInfo: PropTypes.object,
  qtPanelDocker: PropTypes.object,
  qtPanelId: PropTypes.string,
  eventBusObj: PropTypes.objectOf(EventBus),
};