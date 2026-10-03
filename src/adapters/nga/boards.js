// NGA 论坛全版面与子论坛切换模块（移动端精致分栏与全功能选择器）
function mountBoardsManager({ context = globalThis.window, shadow, app, pageURL, prefs, savePrefs }) {
  const window = context;
  const { document, localStorage, location } = window;

  const FORUM_CATEGORIES = [
    {
      id: 'recommend',
      name: '常用热门',
      icon: '🔥',
      desc: 'NGA 最受关注与高热度的综合讨论区',
      forums: [
        { fid: '-7', name: '晴风村 / 水区', desc: '大杂烩 · 情感 · 树洞 · 生活交流' },
        { fid: '7', name: '艾泽拉斯议事厅', desc: '魔兽世界主讨论区 · 综合交流' },
        { fid: '-447601', name: '二次元国家地理', desc: '动漫 · 漫画 · 综合ACG讨论' },
        { fid: '650', name: '原神', desc: '提瓦特大陆冒险 · 攻略与同人' },
        { fid: '510387', name: '崩坏：星穹铁道', desc: '星穹列车开拓之旅' },
        { fid: '510757', name: '绝区零', desc: '新艾利都冒险之旅' },
        { fid: '-34587507', name: '明日方舟', desc: '罗德岛驻艾泽拉斯大使馆' },
        { fid: '757', name: '蔚蓝档案', desc: '基沃托斯联邦搜查社' },
        { fid: '414', name: 'Steam综合讨论', desc: 'PC游戏 · 促销 · 测评心得' },
        { fid: '415', name: '主机游戏', desc: 'PS / Xbox / Switch / 掌机' },
        { fid: '-152678', name: '英雄联盟', desc: 'Let\'s Gank · 赛事与攻略' },
        { fid: '-1459709', name: '职场人生', desc: '工作 · 职场经验 · 薪资交流' },
        { fid: '-343809', name: '汽车俱乐部', desc: '买车选车 · 用车维修心得' },
        { fid: '334', name: 'PC软硬件', desc: '装机配置 · 硬件数码 · 技术排障' }
      ]
    },
    {
      id: 'mobile',
      name: '手机游戏',
      icon: '📱',
      desc: '二次元手游、抽卡养成与移动端热门作品',
      forums: [
        { fid: '650', name: '原神', desc: '米哈游开放世界冒险' },
        { fid: '510387', name: '崩坏：星穹铁道', desc: '银河回合制冒险RPG' },
        { fid: '510757', name: '绝区零', desc: '都市即时动作冒险' },
        { fid: '-34587507', name: '明日方舟', desc: '鹰角网络策略战术' },
        { fid: '757', name: '蔚蓝档案', desc: '青春学园剧情战术' },
        { fid: '510756', name: '鸣潮', desc: '库洛开放世界动作' },
        { fid: '-40743354', name: '赛马娘 PrettyDerby', desc: 'Cygames养成育成' },
        { fid: '-547859', name: '少女前线', desc: '16LAB研究院' },
        { fid: '-195362', name: '少前2：追放', desc: '美式战棋3D角色扮演' },
        { fid: '-60157311', name: '少前:云图计划', desc: 'Roguelike战术探索' },
        { fid: '564', name: '碧蓝航线', desc: '弹幕海战少女养成' },
        { fid: '549', name: '崩坏3', desc: '点燃国创动作之魂' },
        { fid: '510619', name: '重返未来：1999', desc: '近代复古神秘学RPG' },
        { fid: '638', name: '战双帕弥什', desc: '末世科幻动作' },
        { fid: '538', name: '阴阳师', desc: '平安时代和风回合制' },
        { fid: '-452227', name: '精灵宝可梦', desc: '宝可梦全系列游戏讨论' },
        { fid: '-8180483', name: '影之诗', desc: '日系集换式卡牌对战' },
        { fid: '-15219445', name: '巫师之昆特牌', desc: '来盘昆特牌吧' },
        { fid: '-41232751', name: '四叶草剧场', desc: '魔物娘养成' },
        { fid: '-41374941', name: '悠久之树', desc: '正统日系奇幻RPG' },
        { fid: '-60374520', name: '食物语', desc: '中华美食拟人化' }
      ]
    },
    {
      id: 'wow',
      name: '魔兽世界',
      icon: '⚔️',
      desc: '艾泽拉斯主讨论区、怀旧服、团本大秘与全职业大厅',
      forums: [
        { fid: '7', name: '艾泽拉斯议事厅', desc: '魔兽综合主讨论区' },
        { fid: '641', name: '经典旧世 (怀旧服)', desc: '时光回溯 · 怀旧服专区' },
        { fid: '218', name: '副本讨论区', desc: '团本攻略 · 战术与心得' },
        { fid: '533', name: '大秘境集合石', desc: '史诗钥石地下城交流' },
        { fid: '191', name: '地精商会', desc: '商业技能 · 拍卖行心得' },
        { fid: '200', name: '插件技术综合讨论区', desc: '界面排版 · 插件配置' },
        { fid: '274', name: '原创插件发布区', desc: '自制UI与扩展下载' },
        { fid: '310', name: '精英议会', desc: '前瞻高阶理论研究' },
        { fid: '255', name: '团队管理经验交流', desc: '公会运作与团队建设' },
        { fid: '230', name: '艾泽拉斯风纪委员会', desc: '秩序监督与公示' },
        { fid: '254', name: '镶金玫瑰旅店', desc: '酒馆吹水 · 背景故事' },
        { fid: '124', name: '莫高雷壁画洞穴', desc: '暴雪艺术原创同人' },
        { fid: '319', name: '宏命令讨论区', desc: '宏编写与排错' },
        { fid: '182', name: '法师 - 魔法圣堂', desc: '奥术 / 火焰 / 冰霜' },
        { fid: '181', name: '战士 - 铁血沙场', desc: '武器 / 狂怒 / 防护' },
        { fid: '184', name: '圣骑士 - 圣光广场', desc: '神圣 / 防护 / 惩戒' },
        { fid: '183', name: '牧师 - 信仰神殿', desc: '戒律 / 神圣 / 暗影' },
        { fid: '189', name: '潜行者 - 暗影裂口', desc: '奇袭 / 狂徒 / 敏锐' },
        { fid: '186', name: '德鲁伊 - 翡翠梦境', desc: '平衡 / 野性 / 守护 / 恢复' },
        { fid: '187', name: '猎人 - 猎手大厅', desc: '野兽控制 / 射击 / 生存' },
        { fid: '188', name: '术士 - 恶魔深渊', desc: '痛苦 / 恶魔学识 / 毁灭' },
        { fid: '185', name: '萨满 - 风暴祭坛', desc: '元素 / 增强 / 恢复' },
        { fid: '320', name: '死亡骑士 - 黑锋要塞', desc: '鲜血 / 冰霜 / 邪恶' },
        { fid: '390', name: '武僧 - 五晨寺', desc: '酒仙 / 织雾 / 踏风' },
        { fid: '477', name: '恶魔猎手 - 伊利达雷', desc: '浩劫 / 复仇' },
        { fid: '510340', name: '唤魔师 - 禁忌离岛', desc: '湮灭 / 恩护 / 增辉' }
      ]
    },
    {
      id: 'games',
      name: '游戏综合',
      icon: '🎮',
      desc: '单机、Steam、主机掌机、暴雪综合与独立神作',
      forums: [
        { fid: '414', name: 'Steam综合讨论', desc: 'PC游戏促销 · 测评心得' },
        { fid: '415', name: '主机游戏', desc: 'PS / Xbox / Switch / 掌机' },
        { fid: '-362960', name: '最终幻想14', desc: '艾欧泽亚光之战士' },
        { fid: '560', name: '怪物猎人', desc: '苍蓝星狩猎集会所' },
        { fid: '510740', name: '黑神话：悟空', desc: '西游神话动作冒险' },
        { fid: '686', name: '艾尔登法环 / 魂系列', desc: '交界地褪色者 · 魂系探索' },
        { fid: '615', name: '塞尔达传说', desc: '旷野之息 · 王国之泪' },
        { fid: '510389', name: '模拟经营 / 策略战棋', desc: 'P社四萌 · 文明 · 策略SLG' },
        { fid: '332', name: '战锤40K', desc: '战锤宇宙战役与桌面棋' },
        { fid: '632', name: '暴雪游戏综合', desc: '暴雪娱乐产品综合' },
        { fid: '422', name: '炉石传说', desc: '魔兽英雄传 · 酒馆战棋' },
        { fid: '687', name: '暗黑破坏神4', desc: '庇护之地避难所' },
        { fid: '318', name: '暗黑破坏神3', desc: '奈非天秘境刷刷刷' },
        { fid: '459', name: '守望先锋', desc: '英雄竞技射击' },
        { fid: '273', name: '星际争霸2', desc: '科普卢星区RTS' },
        { fid: '431', name: '风暴英雄', desc: '时空枢纽团战竞技' }
      ]
    },
    {
      id: 'esports',
      name: '竞技网游',
      icon: '🏆',
      desc: '英雄联盟、DOTA2、CS2、无畏契约等电竞赛事与攻略',
      forums: [
        { fid: '-152678', name: '英雄联盟', desc: '赛事资讯 · 英雄攻略 · 云顶' },
        { fid: '321', name: 'DOTA2', desc: '刀塔遗迹保卫战 · 赛事交流' },
        { fid: '731', name: '无畏契约 VALORANT', desc: '拳头战术射击对抗' },
        { fid: '548', name: 'CS:GO / CS2', desc: '反恐精英战术竞技' },
        { fid: '653', name: '云顶之弈', desc: '自走棋阵容与羁绊搭配' },
        { fid: '674', name: '永劫无间', desc: '多人动作战术竞技' },
        { fid: '-6194253', name: '战争雷霆', desc: '海陆空拟真载具射击' },
        { fid: '-7861121', name: '剑网3', desc: '大唐武侠MMO' },
        { fid: '-5080470', name: '流放之路', desc: '硬核刷宝暗黑ARPG' },
        { fid: '-235147', name: '激战2', desc: '泰瑞亚大陆动态世界' }
      ]
    },
    {
      id: 'life',
      name: '综合生活',
      icon: '☕',
      desc: '职场、数码硬件、汽车、美食、影音与情感闲聊',
      forums: [
        { fid: '-7', name: '晴风村 / 水区', desc: '大杂烩 · 情感倾诉 · 闲聊树洞' },
        { fid: '-1459709', name: '职场人生', desc: '职场经验 · 薪酬与求职' },
        { fid: '-343809', name: '汽车俱乐部', desc: '选车购车 · 用车维修心得' },
        { fid: '-2122', name: '机车俱乐部', desc: '两轮骑行 · 路线与摩托推荐' },
        { fid: '-576177', name: '影音讨论区', desc: '电影 · 电视剧 · 音乐鉴赏' },
        { fid: '-608808', name: '恩基爱厨艺美食交流', desc: '家庭烹饪 · 探店与食谱' },
        { fid: '334', name: 'PC软硬件', desc: '装机指南 · 评测与故障排查' },
        { fid: '498', name: '消费电子 / 手机数码', desc: '智能手机 · 平板与数码' },
        { fid: '-353371', name: '萌萌宠物', desc: '喵星人 · 汪星人日常' },
        { fid: '-187628', name: 'Home, sweet home', desc: '买房避坑 · 家装家居' },
        { fid: '-447601', name: '二次元国家地理', desc: '动漫追番 · 轻小说杂谈' },
        { fid: '510425', name: '模玩专区', desc: '手办 · 高达 · 兵人与雕像' },
        { fid: '510376', name: '跑团 / TRPG', desc: '桌游 · DND · 跑团战报' },
        { fid: '-7678526', name: '艾泽拉斯麻将科学院', desc: '日麻 · 雀魂与国标' },
        { fid: '-81981', name: '生命之杯', desc: '足球赛事 · 俱乐部与球星' }
      ]
    }
  ];

  const FORUM_MAP = new Map();
  for (const category of FORUM_CATEGORIES) {
    for (const item of category.forums) {
      if (!FORUM_MAP.has(String(item.fid))) FORUM_MAP.set(String(item.fid), item);
    }
  }

  const RECENT_KEY = 'nga-cards-v1-recent-boards';
  function readRecentBoards() {
    try { return JSON.parse(localStorage.getItem(RECENT_KEY)) || []; } catch { return []; }
  }
  function writeRecentBoards(list) {
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 12))); } catch {}
  }
  function recordRecentBoard(item) {
    if (!item || (!item.fid && !item.stid) || !item.name) return;
    const list = readRecentBoards();
    const fid = item.fid ? String(item.fid) : null;
    const stid = item.stid ? String(item.stid) : null;
    const filtered = list.filter(b => (fid ? b.fid !== fid : true) && (stid ? b.stid !== stid : true));
    filtered.unshift({
      fid, stid, name: item.name,
      desc: item.desc || (fid ? `FID ${fid}` : `STID ${stid}`),
      url: item.url || (stid ? `/thread.php?stid=${stid}` : `/thread.php?fid=${fid}`),
      time: Date.now()
    });
    writeRecentBoards(filtered);
  }
  function clearRecentBoards() {
    try { localStorage.removeItem(RECENT_KEY); } catch {}
  }

  function extractCurrentSubforums(doc = document, win = window, url = pageURL) {
    const list = [], seen = new Set();
    const curFid = url.searchParams.get('fid');
    const curStid = url.searchParams.get('stid');

    const allData = win.__ALL_FORUM_DATA;
    if (allData && typeof allData === 'object') {
      for (const [key, val] of Object.entries(allData)) {
        if (!Array.isArray(val) || val.length < 2) continue;
        const rawId = String(val[0] || key);
        const isStid = rawId.startsWith('t') || rawId.startsWith('s') || ((Number(val[4]) & 16) !== 0);
        const cleanId = rawId.replace(/^[ts]/, '');
        if ((isStid && cleanId === curStid) || (!isStid && cleanId === curFid)) continue;
        const keyStr = isStid ? `stid:${cleanId}` : `fid:${cleanId}`;
        if (seen.has(keyStr)) continue;
        seen.add(keyStr);
        const name = String(val[1] || '').trim();
        const desc = String(val[2] || '').trim();
        if (!name || name.length < 2) continue;
        const targetUrl = isStid ? `/thread.php?stid=${cleanId}` : `/thread.php?fid=${cleanId}`;
        list.push({ fid: isStid ? null : cleanId, stid: isStid ? cleanId : null, name, desc, url: targetUrl });
      }
    }

    const subLinks = doc.querySelectorAll('#sub_forums_c a[href*="thread.php"], #more_sub_forums_c a[href*="thread.php"]');
    for (const a of subLinks) {
      const raw = a.getAttribute('href');
      if (!raw) continue;
      let u; try { u = new URL(raw, win.location.href); } catch { continue; }
      const fid = u.searchParams.get('fid'), stid = u.searchParams.get('stid');
      if (!fid && !stid) continue;
      if ((fid && fid === curFid) || (stid && stid === curStid)) continue;
      const keyStr = stid ? `stid:${stid}` : `fid:${fid}`;
      if (seen.has(keyStr)) continue;
      seen.add(keyStr);
      const name = a.textContent.trim().replace(/\s*\([^)]*\)\s*$/, '').trim();
      if (!name || name.length < 2) continue;
      list.push({ fid, stid, name, desc: '', url: u.pathname + u.search });
    }

    return list;
  }

  function detectBoardInfo(doc = document, win = window, url = pageURL) {
    const fid = url.searchParams.get('fid');
    const stid = url.searchParams.get('stid');

    if (fid && FORUM_MAP.has(fid)) {
      return { fid, stid, name: FORUM_MAP.get(fid).name };
    }

    if (win.__ALL_FORUM_DATA && typeof win.__ALL_FORUM_DATA === 'object') {
      if (fid && win.__ALL_FORUM_DATA[fid]?.[1]) {
        return { fid, stid, name: String(win.__ALL_FORUM_DATA[fid][1]).trim() };
      }
      if (stid && win.__ALL_FORUM_DATA[`t${stid}`]?.[1]) {
        return { fid, stid, name: String(win.__ALL_FORUM_DATA[`t${stid}`][1]).trim() };
      }
    }

    const navLink = doc.querySelector('#m_nav h1 a, .nav h1 a, #m_nav .nav_link, .nav_link');
    if (navLink && navLink.textContent.trim().length > 1) {
      return { fid, stid, name: navLink.textContent.trim() };
    }

    const boardA = [...doc.querySelectorAll('#m_nav a[href*="thread.php"], a[href*="thread.php"]')].find(a => {
      try {
        const u = new URL(a.getAttribute('href'), win.location.href);
        return (stid && u.searchParams.get('stid') === stid) || (fid && u.searchParams.get('fid') === fid);
      } catch { return false; }
    });
    if (boardA && boardA.textContent.trim().length > 1) {
      return { fid, stid, name: boardA.textContent.trim() };
    }

    const cleanTitle = (doc.title || '').replace(/\s*[-_].*NGA.*$/i, '').trim();
    if (cleanTitle && cleanTitle !== '访客不能直接访问' && cleanTitle !== '未登录' && cleanTitle !== 'NGA玩家社区') {
      return { fid, stid, name: cleanTitle };
    }

    return {
      fid, stid,
      name: fid ? `板块 (FID ${fid})` : (stid ? `主题集 (${stid})` : '论坛发现')
    };
  }

  // 构建板块切换器 UI 样式与弹窗（分栏布局）
  const style = node('style', '', `
    .board-dialog{position:fixed;z-index:2147483015;inset:0;width:100vw;height:100dvh;max-width:100vw;max-height:100dvh;margin:0;padding:0;border:0;background:rgba(0,0,0,.45);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;box-sizing:border-box;touch-action:pan-y;overscroll-behavior:contain}
    .board-dialog:not([open]){display:none!important}
    .board-dialog::backdrop{background:transparent}

    .board-dialog-sheet{width:min(780px,calc(100vw - 24px));height:min(86dvh,760px);max-height:86dvh;background:#fff;color:#27272b;border:1px solid #e8e8ed;border-radius:24px;box-shadow:0 14px 50px rgba(0,0,0,.25);font:14px/1.5 system-ui;display:flex;flex-direction:column;overscroll-behavior:contain;overflow:hidden;touch-action:pan-y;position:relative}

    .board-handle{display:none;width:100%;height:18px;align-items:center;justify-content:center;cursor:grab;flex:none;touch-action:none}
    .board-handle::before{content:'';width:38px;height:4.5px;border-radius:3px;background:#d0d0d6}

    .board-dialog-header{display:flex;align-items:center;justify-content:space-between;padding:16px 20px 12px;border-bottom:1px solid #f0f0f3;flex:none;touch-action:none}
    .board-dialog-title{display:flex;align-items:center;gap:8px;font-size:17px;font-weight:700;color:#222}
    .board-dialog-title .board-icon{font-size:19px}
    .board-dialog-close{font-size:24px;line-height:1;width:34px;height:34px;border-radius:50%;display:grid;place-items:center;color:#888;transition:background .15s}
    .board-dialog-close:hover{background:#f0f0f4;color:#222}
    
    .board-search-box{padding:10px 20px;background:#fafafc;border-bottom:1px solid #f0f0f3;display:flex;align-items:center;gap:10px;flex:none}
    .board-search-icon{color:#999;flex:none}
    .board-search-input{flex:1;border:1px solid #e2e2e7;border-radius:22px;padding:9px 16px;background:#fff;color:#222;font-size:14px;outline:none;transition:border-color .15s}
    .board-search-input:focus{border-color:#ff2442}
    .board-jump-fid{flex:none;background:#ff2442;color:#fff;border-radius:20px;padding:7px 14px;font-size:13px;font-weight:600;white-space:nowrap;transition:filter .15s}
    .board-jump-fid:hover{filter:brightness(1.08)}

    /* 左右分栏核心容器 */
    .board-split-layout{flex:1;display:flex;min-height:0;height:100%;overflow:hidden}
    
    /* 左侧栏目导航 */
    .board-sidebar{width:150px;background:#f7f7f9;border-right:1px solid #f0f0f3;overflow-y:auto;display:flex;flex-direction:column;padding:8px 0;flex:none;touch-action:pan-y;overscroll-behavior-y:contain;-webkit-overflow-scrolling:touch}
    .board-cat-item{display:flex;align-items:center;justify-content:space-between;padding:12px 14px;font-size:13px;font-weight:550;color:#555;cursor:pointer;border-left:3px solid transparent;transition:background .15s,color .15s,border-color .15s;text-align:left;position:relative;touch-action:pan-y}
    .board-cat-item:hover{background:#efeff2;color:#111}
    .board-cat-item.is-active{background:#fff;color:#ff2442;font-weight:700;border-left-color:#ff2442}
    .board-cat-item-main{display:flex;align-items:center;gap:6px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .board-cat-item-badge{font-size:10px;background:#ffe6eb;color:#ff2442;padding:1px 6px;border-radius:10px;font-weight:600}
    
    /* 右侧板块列表内容区 */
    .board-main-pane{flex:1;overflow-y:auto;padding:16px 20px;display:flex;flex-direction:column;gap:14px;min-width:0;touch-action:pan-y;overscroll-behavior-y:contain;-webkit-overflow-scrolling:touch}
    .board-pane-header{display:flex;align-items:center;justify-content:space-between;gap:10px;padding-bottom:10px;border-bottom:1px solid #f4f4f6}
    .board-pane-title{font-size:15px;font-weight:700;color:#333}
    .board-pane-desc{font-size:12px;color:#888;margin-top:2px}
    .board-pane-extra{flex:none}
    
    /* 搜索全屏结果视图 */
    .board-search-results{flex:1;overflow-y:auto;padding:16px 20px;touch-action:pan-y;overscroll-behavior-y:contain;-webkit-overflow-scrolling:touch}

    /* 板块卡片网格 */
    .board-cards-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px}
    .board-card{display:flex;flex-direction:column;justify-content:space-between;padding:12px 14px;border-radius:14px;background:#f9f9fb;border:1px solid #eeeeef;transition:transform .14s,box-shadow .14s,border-color .14s;text-decoration:none;min-height:74px;touch-action:pan-y}
    .board-card:hover{transform:translateY(-2px);background:#fff;box-shadow:0 4px 14px #0000000a;border-color:#ffd4df}
    .board-card.is-active{background:#fff8fa;border-color:#ff8ba0}
    .board-card-main{display:flex;align-items:center;justify-content:space-between;gap:6px}
    .board-card-name{font-size:14px;font-weight:650;color:#222}
    .board-card.is-active .board-card-name{color:#ff2442}
    .board-card-active-tag{font-size:10px;background:#ff2442;color:#fff;padding:2px 6px;border-radius:8px;font-weight:600;flex:none}
    .board-card-desc{font-size:11px;color:#888;margin-top:4px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;line-height:1.4}
    .board-card-meta{display:flex;align-items:center;justify-content:space-between;margin-top:8px;font-size:11px;color:#aaa}
    .board-card-fid{background:#eaeaef;color:#666;padding:1px 6px;border-radius:6px;font-size:10px}

    /* Chip 样式（兼容旧版与快捷标签） */
    .board-chips-grid{display:flex;flex-wrap:wrap;gap:8px}
    .board-chip{display:inline-flex;align-items:center;gap:6px;padding:7px 13px;border-radius:18px;background:#f3f3f6;color:#333;font-size:13px;transition:background .15s,color .15s;text-decoration:none;touch-action:manipulation}
    .board-chip:hover{background:#e7e7ec;color:#111}
    .board-chip.is-active{background:#fff0f3;color:#ff2442;font-weight:650;border:1px solid #ffd4df}
    .board-chip-desc{font-size:11px;color:#888;font-weight:normal}
    .board-clear-recent{font-size:12px;color:#999;cursor:pointer;padding:2px 8px;border-radius:12px}
    .board-clear-recent:hover{background:#f0f0f4;color:#666}

    .board-empty-search{text-align:center;padding:36px 12px;color:#888;font-size:14px}
    .board-empty-search strong{color:#ff2442}

    .board-dialog-footer{padding:10px 20px;border-top:1px solid #f0f0f3;display:flex;align-items:center;justify-content:space-between;font-size:12px;color:#888;background:#fafafc;flex:none}
    .board-native-link{color:#a43d60;text-decoration:none}
    .board-native-link:hover{text-decoration:underline}

    /* 列表顶部子版块横向标签栏 */
    .subforum-strip{display:flex;align-items:center;gap:8px;overflow-x:auto;width:100%;max-width:100%;box-sizing:border-box;padding:6px 0 12px;margin-top:-4px;scrollbar-width:none;-webkit-overflow-scrolling:touch;touch-action:pan-x;overscroll-behavior-x:contain}
    .subforum-strip[hidden]{display:none!important}
    .subforum-strip::-webkit-scrollbar{display:none}
    .subforum-chip{display:inline-flex;align-items:center;gap:5px;padding:6px 13px;border-radius:16px;background:#f1f1f4;color:#555;font-size:12px;white-space:nowrap;transition:background .15s,color .15s;text-decoration:none;flex:none;touch-action:pan-x;-webkit-tap-highlight-color:transparent}
    .subforum-chip:hover{background:#e6e6eb;color:#222}
    .subforum-chip.is-active{background:#ff2442;color:#fff;font-weight:600}
    .subforum-chip-more{background:#fff;border:1px dashed #dcdce2;color:#a43d60;cursor:pointer}
    .subforum-chip-more:hover{background:#fff0f3;border-color:#ff8ba0;color:#ff2442}

    /* 顶部标题旁快捷切换板块徽章 */
    .board-title{display:inline-flex;align-items:center;gap:10px;flex-wrap:wrap;cursor:pointer}
    .board-title-switch{display:inline-flex;align-items:center;gap:4px;font-size:12px;font-weight:600;padding:4px 10px;border-radius:14px;background:#f3f3f6;color:#666;border:1px solid #e4e4e9;transition:background .15s,border-color .15s,color .15s}
    .board-title:hover .board-title-switch,.board-title-switch:hover{background:#fff0f3;color:#ff2442;border-color:#ffd4df}
    .board-bar-btn{display:inline-flex;align-items:center;gap:5px;padding:7px 13px;border-radius:20px;background:#fff0f3;color:#ff2442;font-size:13px;font-weight:600;white-space:nowrap;transition:background .15s}
    .board-bar-btn:hover{background:#ffe2e8}

    /* 暗色主题适配 */
    .app.rt-dark .board-dialog-sheet, .app.rt-dark ~ .board-dialog .board-dialog-sheet, .board-dialog[data-rt-theme=dark] .board-dialog-sheet{background:#202329;color:#e2e2e7;border-color:#34373e;box-shadow:0 12px 48px #00000066}
    .app.rt-dark .board-dialog-header, .app.rt-dark ~ .board-dialog .board-dialog-header, .board-dialog[data-rt-theme=dark] .board-dialog-header,
    .app.rt-dark .board-dialog-footer, .app.rt-dark ~ .board-dialog .board-dialog-footer, .board-dialog[data-rt-theme=dark] .board-dialog-footer,
    .app.rt-dark .board-search-box, .app.rt-dark ~ .board-dialog .board-search-box, .board-dialog[data-rt-theme=dark] .board-search-box{background:#1a1c20;border-color:#2c3038}
    .app.rt-dark .board-sidebar, .app.rt-dark ~ .board-dialog .board-sidebar, .board-dialog[data-rt-theme=dark] .board-sidebar{background:#181a1f;border-color:#2c3038}
    .app.rt-dark .board-cat-item, .app.rt-dark ~ .board-dialog .board-cat-item, .board-dialog[data-rt-theme=dark] .board-cat-item{color:#aaa}
    .app.rt-dark .board-cat-item:hover, .app.rt-dark ~ .board-dialog .board-cat-item:hover, .board-dialog[data-rt-theme=dark] .board-cat-item:hover{background:#22252c;color:#eee}
    .app.rt-dark .board-cat-item.is-active, .app.rt-dark ~ .board-dialog .board-cat-item.is-active, .board-dialog[data-rt-theme=dark] .board-cat-item.is-active{background:#202329;color:#ff8ba0;border-left-color:#ff2442}
    .app.rt-dark .board-pane-header, .app.rt-dark ~ .board-dialog .board-pane-header, .board-dialog[data-rt-theme=dark] .board-pane-header{border-color:#2c3038}
    .app.rt-dark .board-pane-title, .app.rt-dark ~ .board-dialog .board-pane-title, .board-dialog[data-rt-theme=dark] .board-pane-title{color:#eee}
    .app.rt-dark .board-dialog-title, .app.rt-dark ~ .board-dialog .board-dialog-title, .board-dialog[data-rt-theme=dark] .board-dialog-title{color:#eee}
    .app.rt-dark .board-search-input, .app.rt-dark ~ .board-dialog .board-search-input, .board-dialog[data-rt-theme=dark] .board-search-input{background:#282c34;color:#eee;border-color:#3b404b}
    .app.rt-dark .board-chip, .app.rt-dark ~ .board-dialog .board-chip, .board-dialog[data-rt-theme=dark] .board-chip{background:#2c3038;color:#bbb}
    .app.rt-dark .board-chip:hover, .app.rt-dark ~ .board-dialog .board-chip:hover, .board-dialog[data-rt-theme=dark] .board-chip:hover{background:#383d47;color:#fff}
    .app.rt-dark .board-chip.is-active, .app.rt-dark ~ .board-dialog .board-chip.is-active, .board-dialog[data-rt-theme=dark] .board-chip.is-active{background:#422530;color:#ff8ba0;border-color:#653342}
    .app.rt-dark .board-card, .app.rt-dark ~ .board-dialog .board-card, .board-dialog[data-rt-theme=dark] .board-card{background:#252930;border-color:#323742}
    .app.rt-dark .board-card:hover, .app.rt-dark ~ .board-dialog .board-card:hover, .board-dialog[data-rt-theme=dark] .board-card:hover{background:#2b3039;border-color:#ff8ba0}
    .app.rt-dark .board-card.is-active, .app.rt-dark ~ .board-dialog .board-card.is-active, .board-dialog[data-rt-theme=dark] .board-card.is-active{background:#35252e;border-color:#ff8ba0}
    .app.rt-dark .board-card-name, .app.rt-dark ~ .board-dialog .board-card-name, .board-dialog[data-rt-theme=dark] .board-card-name{color:#eee}
    .app.rt-dark .board-card-fid, .app.rt-dark ~ .board-dialog .board-card-fid, .board-dialog[data-rt-theme=dark] .board-card-fid{background:#1b1d22;color:#aaa}
    .app.rt-dark .subforum-chip, .app.rt-dark ~ .board-dialog .subforum-chip, .board-dialog[data-rt-theme=dark] .subforum-chip{background:#262a32;color:#aaa}
    .app.rt-dark .subforum-chip:hover, .app.rt-dark ~ .board-dialog .subforum-chip:hover, .board-dialog[data-rt-theme=dark] .subforum-chip:hover{background:#323742;color:#fff}
    .app.rt-dark .subforum-chip.is-active, .app.rt-dark ~ .board-dialog .subforum-chip.is-active, .board-dialog[data-rt-theme=dark] .subforum-chip.is-active{background:#ff2442;color:#fff}
    .app.rt-dark .board-title-switch, .app.rt-dark ~ .board-dialog .board-title-switch, .board-dialog[data-rt-theme=dark] .board-title-switch{background:#262a32;border-color:#383747;color:#aaa}
    .app.rt-dark .board-bar-btn, .app.rt-dark ~ .board-dialog .board-bar-btn, .board-dialog[data-rt-theme=dark] .board-bar-btn{background:#3e242c;color:#ff8ba0}

    /* 手机端分栏与抽屉优化 */
    @media(max-width:600px){
      .board-dialog{align-items:flex-end}
      .board-dialog-sheet{width:100vw;max-width:100vw;height:86dvh;max-height:86dvh;border-radius:20px 20px 0 0;border:0;box-shadow:0 -8px 36px rgba(0,0,0,.25)}
      .board-handle{display:flex;height:20px}
      .board-handle::before{width:40px;height:5px}
      .board-sidebar{width:108px;padding:4px 0}
      .board-cat-item{padding:12px 8px;font-size:12.5px}
      .board-cat-item-main{gap:4px}
      .board-main-pane{padding:12px 14px}
      .board-cards-grid{grid-template-columns:1fr;gap:8px}
      .board-card{padding:11px 12px;min-height:60px}
      .board-dialog-header{padding:6px 16px 8px}
      .board-dialog-title{font-size:16px}
      .board-search-box{padding:8px 14px}
      .board-dialog-footer{padding:8px 14px calc(8px + env(safe-area-inset-bottom))}
    }

    /* 论坛独立主页 Portal 全景布局与分栏 */
    .board-portal-view{max-width:1280px;margin:8px auto 48px;display:flex;flex-direction:column;gap:18px;width:100%;box-sizing:border-box}
    .board-portal-banner{padding:22px 26px;background:linear-gradient(135deg,#fff0f3 0%,#fdf6f9 100%);border-radius:20px;border:1px solid #ffd4df;display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap}
    .board-portal-title{margin:0 0 5px;font-size:20px;font-weight:750;color:#222}
    .board-portal-sub{font-size:13px;color:#666;line-height:1.5}
    .board-portal-actions{display:flex;align-items:center;gap:10px}
    .board-portal-native-link{font-size:12.5px;color:#a43d60;padding:6px 14px;border-radius:16px;background:#fff;border:1px solid #fed4df;text-decoration:none;transition:background .15s}
    .board-portal-native-link:hover{background:#fff0f3}
    
    .board-portal-search-wrap{display:flex;align-items:center;gap:10px;background:#fff;border:1px solid #e2e2e7;border-radius:24px;padding:7px 16px;box-shadow:0 2px 8px rgba(0,0,0,0.03);transition:border-color .15s}
    .board-portal-search-wrap:focus-within{border-color:#ff2442}
    .board-portal-search-input{flex:1;border:none;outline:none;font-size:14px;background:transparent;color:#222}
    .board-portal-jump-fid{flex:none;background:#ff2442;color:#fff;border-radius:18px;padding:6px 13px;font-size:12.5px;font-weight:600;white-space:nowrap;cursor:pointer}
    
    .board-portal-cat-bar{display:flex;align-items:center;gap:8px;overflow-x:auto;width:100%;max-width:100%;box-sizing:border-box;padding:2px 0 8px;scrollbar-width:none;-webkit-overflow-scrolling:touch;touch-action:pan-x;overscroll-behavior-x:contain}
    .board-portal-cat-bar::-webkit-scrollbar{display:none}
    .board-portal-cat-btn{display:inline-flex;align-items:center;gap:6px;padding:7px 15px;border-radius:18px;background:#f2f2f5;color:#555;font-size:13px;font-weight:550;white-space:nowrap;cursor:pointer;border:0;transition:background .15s,color .15s;flex:none}
    .board-portal-cat-btn:hover{background:#e8e8ed;color:#111}
    .board-portal-cat-btn.is-active{background:#ff2442;color:#fff;font-weight:650}
    
    .board-portal-sections{display:flex;flex-direction:column;gap:20px}
    .board-portal-section{display:flex;flex-direction:column;gap:12px}
    .board-portal-section-header{display:flex;align-items:baseline;justify-content:space-between;gap:12px;padding-bottom:8px;border-bottom:2px solid #f2f2f5}
    .board-portal-section-title{display:flex;align-items:center;gap:8px;font-size:16.5px;font-weight:750;color:#222}
    .board-portal-section-count{font-size:11px;background:#f0f0f4;color:#666;padding:2px 7px;border-radius:10px;font-weight:600}
    .board-portal-section-desc{font-size:12px;color:#888}
    
    .board-portal-cards-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:12px}
    .board-portal-card{display:flex;flex-direction:column;justify-content:space-between;padding:13px 15px;border-radius:15px;background:#fff;border:1px solid #ebebf0;box-shadow:0 2px 6px rgba(0,0,0,0.02);transition:transform .15s,box-shadow .15s,border-color .15s;text-decoration:none;min-height:76px;box-sizing:border-box}
    .board-portal-card:hover{transform:translateY(-2px);box-shadow:0 6px 18px rgba(0,0,0,0.06);border-color:#ffd4df}
    .board-portal-card-top{display:flex;align-items:center;justify-content:space-between;gap:8px}
    .board-portal-card-name{font-size:14px;font-weight:700;color:#222}
    .board-portal-card:hover .board-portal-card-name{color:#ff2442}
    .board-portal-card-fid{font-size:10.5px;background:#f2f2f6;color:#777;padding:1px 6px;border-radius:6px;font-weight:600;flex:none}
    .board-portal-card-desc{font-size:11.5px;color:#777;margin-top:5px;line-height:1.45;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}

    /* Portal 暗色适配 */
    .app.rt-dark .board-portal-banner{background:linear-gradient(135deg,#2b1f25 0%,#1f2127 100%);border-color:#482833}
    .app.rt-dark .board-portal-title{color:#f0f0f5}
    .app.rt-dark .board-portal-sub{color:#aaa}
    .app.rt-dark .board-portal-native-link{background:#282b32;border-color:#482833;color:#ff8ba0}
    .app.rt-dark .board-portal-search-wrap{background:#202329;border-color:#34373e}
    .app.rt-dark .board-portal-search-input{color:#eee}
    .app.rt-dark .board-portal-cat-btn{background:#23262d;color:#aaa}
    .app.rt-dark .board-portal-cat-btn:hover{background:#2e323b;color:#fff}
    .app.rt-dark .board-portal-cat-btn.is-active{background:#ff2442;color:#fff}
    .app.rt-dark .board-portal-section-header{border-color:#2d3038}
    .app.rt-dark .board-portal-section-title{color:#eee}
    .app.rt-dark .board-portal-section-count{background:#292d35;color:#aaa}
    .app.rt-dark .board-portal-section-desc{color:#888}
    .app.rt-dark .board-portal-card{background:#202329;border-color:#31353e}
    .app.rt-dark .board-portal-card:hover{background:#262a32;border-color:#ff8ba0}
    .app.rt-dark .board-portal-card-name{color:#eee}
    .app.rt-dark .board-portal-card-fid{background:#2c3038;color:#aaa}
    .app.rt-dark .board-portal-card-desc{color:#999}

    /* 打开弹窗时阻断底层滚动 */
    :host-context(.boards-open), .app.boards-open{overflow:hidden!important}
  `);

  (shadow || app).append(style);

  const dialog = node('dialog', 'board-dialog');
  dialog.setAttribute('aria-label', '选择论坛板块');

  // Sheet 容器承载抽屉卡片主体，dialog 自身作为全屏遮罩与手势隔离层
  const sheet = node('div', 'board-dialog-sheet');

  // 手机端顶部滑动指示条
  const handle = node('div', 'board-handle');

  const header = node('div', 'board-dialog-header');
  const titleWrap = node('div', 'board-dialog-title');
  titleWrap.append(node('span', 'board-icon', '🧭'), node('span', '', '切换论坛板块'));
  const closeBtn = button('×', 'board-dialog-close', () => close());
  closeBtn.setAttribute('aria-label', '关闭板块切换');
  header.append(titleWrap, closeBtn);

  const searchBox = node('div', 'board-search-box');
  const searchSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  searchSvg.setAttribute('class', 'board-search-icon');
  searchSvg.setAttribute('viewBox', '0 0 24 24'); searchSvg.setAttribute('width', '18'); searchSvg.setAttribute('height', '18');
  searchSvg.innerHTML = '<path d="M21 21l-4.3-4.3M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>';
  const searchInput = node('input', 'board-search-input');
  searchInput.type = 'text';
  searchInput.setAttribute('inputmode', 'search');
  searchInput.placeholder = '搜索板块名称，或输入 FID 直达…';
  searchInput.setAttribute('aria-label', '搜索板块名称或输入板块ID');
  const jumpFidBtn = button('进入 FID ➔', 'board-jump-fid', () => jumpToFid(searchInput.value.trim()));
  jumpFidBtn.hidden = true;
  searchBox.append(searchSvg, searchInput, jumpFidBtn);

  // 左右分栏容器
  const splitLayout = node('div', 'board-split-layout');
  const sidebar = node('nav', 'board-sidebar');
  sidebar.setAttribute('aria-label', '版面分类导航');
  sidebar.setAttribute('role', 'tablist');

  const mainPane = node('main', 'board-main-pane');
  const paneHeader = node('div', 'board-pane-header');
  const paneTitleWrap = node('div');
  const paneTitle = node('div', 'board-pane-title', '常用热门');
  const paneDesc = node('div', 'board-pane-desc', '');
  paneTitleWrap.append(paneTitle, paneDesc);
  const paneExtra = node('div', 'board-pane-extra');
  paneHeader.append(paneTitleWrap, paneExtra);

  function handleClearRecent() {
    clearRecentBoards();
    testRecentSection.hidden = true;
    testRecentList.replaceChildren();
    activeCategoryId = 'recommend';
    renderSidebar();
    renderRightPane();
  }

  // 兼容测试容器：隐藏的 subforums 与 recent 容器保留 class 供 querySelector 使用
  const testSubSection = node('div', 'board-section board-section-subforums'); testSubSection.hidden = true;
  const testSubList = node('div', 'board-chips-grid board-subforums-list'); testSubSection.append(testSubList);
  const testRecentSection = node('div', 'board-section board-section-recent'); testRecentSection.hidden = true;
  const testRecentList = node('div', 'board-chips-grid board-recent-list');
  const testClearRecent = button('清空', 'board-clear-recent', () => handleClearRecent());
  testRecentSection.append(testRecentList, testClearRecent);
  // 保留隐藏的 category tabs 容器兼容旧测试 querySelector
  const testCatTabs = node('div', 'board-category-tabs'); testCatTabs.hidden = true;

  const cardsGrid = node('div', 'board-cards-grid');
  mainPane.append(paneHeader, cardsGrid, testSubSection, testRecentSection, testCatTabs);

  splitLayout.append(sidebar, mainPane);

  // 搜索全屏视图
  const searchResults = node('div', 'board-search-results');
  searchResults.hidden = true;
  const searchCardsGrid = node('div', 'board-cards-grid board-search-grid');
  searchResults.append(searchCardsGrid);

  const footer = node('div', 'board-dialog-footer');
  footer.append(
    node('span', '', '💡 支持输入任意版面 FID 直达'),
    link('/forum.php', '原版全部板块 ↗', 'board-native-link')
  );
  footer.querySelector('a').dataset.readscapeNative = 'true';

  sheet.append(handle, header, searchBox, splitLayout, searchResults, footer);
  dialog.append(sheet);
  (shadow || app).append(dialog);

  // 状态变量
  let activeCategoryId = 'recommend';
  let searchQuery = '';
  let cachedSubforums = [];

  function jumpToFid(fid) {
    const clean = fid.replace(/^[^\d-]+/, '').trim();
    if (/^-?\d+$/.test(clean)) {
      recordRecentBoard({ fid: clean, name: FORUM_MAP.get(clean)?.name || `板块 FID ${clean}` });
      close();
      window.location.assign(`/thread.php?fid=${clean}`);
    }
  }

  function renderSidebar() {
    sidebar.replaceChildren();
    const recent = readRecentBoards();

    // 组织栏目列表
    const categories = [];

    // 1. 常用热门
    categories.push({ id: 'recommend', name: '常用热门', icon: '🔥' });

    // 2. 当前子版块（如有）
    if (cachedSubforums.length) {
      categories.push({ id: 'subforums', name: '当前子版', icon: '📂', badge: String(cachedSubforums.length) });
    }

    // 3. 最近访问（如有）
    if (recent.length) {
      categories.push({ id: 'recent', name: '最近访问', icon: '🕒', badge: String(recent.length) });
    }

    // 4. 其余分类
    for (const cat of FORUM_CATEGORIES) {
      if (cat.id !== 'recommend') {
        categories.push({ id: cat.id, name: cat.name, icon: cat.icon });
      }
    }

    // 确保激活分类存在
    if (!categories.some(c => c.id === activeCategoryId)) {
      activeCategoryId = 'recommend';
    }

    for (const cat of categories) {
      const item = node('button', `board-cat-item${cat.id === activeCategoryId ? ' is-active' : ''}`);
      item.type = 'button';
      item.setAttribute('role', 'tab');
      item.setAttribute('aria-selected', String(cat.id === activeCategoryId));

      const mainSpan = node('span', 'board-cat-item-main');
      mainSpan.append(node('span', '', cat.icon), document.createTextNode(` ${cat.name}`));
      item.append(mainSpan);

      if (cat.badge) {
        item.append(node('span', 'board-cat-item-badge', cat.badge));
      }

      item.addEventListener('click', () => {
        activeCategoryId = cat.id;
        renderSidebar();
        renderRightPane();
      });

      sidebar.append(item);
    }
  }

  function renderRightPane() {
    cardsGrid.replaceChildren();
    paneExtra.replaceChildren();
    const curFid = pageURL.searchParams.get('fid');
    const curStid = pageURL.searchParams.get('stid');

    if (activeCategoryId === 'subforums') {
      paneTitle.textContent = '当前板块子版块';
      paneDesc.textContent = `共 ${cachedSubforums.length} 个子版块或关联合集`;
      testSubSection.hidden = false;
      testSubList.replaceChildren();

      for (const sub of cachedSubforums) {
        const isCur = (sub.fid && sub.fid === curFid) || (sub.stid && sub.stid === curStid);
        const card = link(sub.url, '', `board-card${isCur ? ' is-active' : ''}`);

        const mainRow = node('div', 'board-card-main');
        mainRow.append(node('span', 'board-card-name', sub.name));
        if (isCur) mainRow.append(node('span', 'board-card-active-tag', '当前'));
        card.append(mainRow);

        if (sub.desc) card.append(node('div', 'board-card-desc', sub.desc));

        const meta = node('div', 'board-card-meta');
        if (sub.fid) meta.append(node('span', 'board-card-fid', `FID ${sub.fid}`));
        else if (sub.stid) meta.append(node('span', 'board-card-fid', `STID ${sub.stid}`));
        card.append(meta);

        card.addEventListener('click', () => { recordRecentBoard(sub); close(); });
        cardsGrid.append(card);

        // 同时放入 testSubList 兼容测试查找
        const chip = link(sub.url, sub.name, `board-chip${isCur ? ' is-active' : ''}`);
        chip.addEventListener('click', () => { recordRecentBoard(sub); close(); });
        testSubList.append(chip);
      }
      return;
    }

    if (activeCategoryId === 'recent') {
      const recent = readRecentBoards();
      paneTitle.textContent = '最近访问板块';
      paneDesc.textContent = `保留最近浏览过的 ${recent.length} 个板块`;

      const clearBtn = button('清空历史', 'board-clear-recent', () => {
        handleClearRecent();
      });
      paneExtra.append(clearBtn);

      testRecentSection.hidden = false;
      testRecentList.replaceChildren();

      for (const item of recent) {
        const isCur = (item.fid && item.fid === curFid) || (item.stid && item.stid === curStid);
        const card = link(item.url, '', `board-card${isCur ? ' is-active' : ''}`);

        const mainRow = node('div', 'board-card-main');
        mainRow.append(node('span', 'board-card-name', item.name));
        if (isCur) mainRow.append(node('span', 'board-card-active-tag', '当前'));
        card.append(mainRow);

        if (item.desc) card.append(node('div', 'board-card-desc', item.desc));

        const meta = node('div', 'board-card-meta');
        if (item.fid) meta.append(node('span', 'board-card-fid', `FID ${item.fid}`));
        else if (item.stid) meta.append(node('span', 'board-card-fid', `STID ${item.stid}`));
        card.append(meta);

        card.addEventListener('click', () => { recordRecentBoard(item); close(); });
        cardsGrid.append(card);

        // 同时放入 testRecentList 兼容测试查找
        const chip = link(item.url, item.name, `board-chip${isCur ? ' is-active' : ''}`);
        chip.addEventListener('click', () => { recordRecentBoard(item); close(); });
        testRecentList.append(chip);
      }
      return;
    }

    // 标准分类板块
    const cat = FORUM_CATEGORIES.find(c => c.id === activeCategoryId) || FORUM_CATEGORIES[0];
    paneTitle.textContent = `${cat.icon} ${cat.name}`;
    paneDesc.textContent = cat.desc || `共 ${cat.forums.length} 个推荐板块`;

    for (const forum of cat.forums) {
      const isCur = String(forum.fid) === curFid;
      const url = forum.url || `/thread.php?fid=${forum.fid}`;
      const card = link(url, '', `board-card${isCur ? ' is-active' : ''}`);

      const mainRow = node('div', 'board-card-main');
      mainRow.append(node('span', 'board-card-name', forum.name));
      if (isCur) mainRow.append(node('span', 'board-card-active-tag', '当前'));
      card.append(mainRow);

      if (forum.desc) card.append(node('div', 'board-card-desc', forum.desc));

      const meta = node('div', 'board-card-meta');
      if (forum.fid) meta.append(node('span', 'board-card-fid', `FID ${forum.fid}`));
      else if (forum.stid) meta.append(node('span', 'board-card-fid', `STID ${forum.stid}`));
      card.append(meta);

      card.addEventListener('click', () => {
        recordRecentBoard({ fid: forum.fid, stid: forum.stid, name: forum.name, url });
        close();
      });

      cardsGrid.append(card);
    }
  }

  function renderSearchResults() {
    searchCardsGrid.replaceChildren();
    const q = searchQuery.toLowerCase().trim();
    const curFid = pageURL.searchParams.get('fid');

    const seenFids = new Set();
    const matched = [];

    // 全局匹配各分类
    for (const cat of FORUM_CATEGORIES) {
      for (const forum of cat.forums) {
        const fidStr = String(forum.fid);
        if (seenFids.has(fidStr)) continue;
        if (forum.name.toLowerCase().includes(q) || (forum.desc && forum.desc.toLowerCase().includes(q)) || fidStr.includes(q)) {
          seenFids.add(fidStr);
          matched.push(forum);
        }
      }
    }

    // 匹配子版块
    for (const sub of cachedSubforums) {
      const idStr = sub.fid || sub.stid || '';
      if (sub.name.toLowerCase().includes(q) || idStr.includes(q)) {
        matched.push(sub);
      }
    }

    if (!matched.length) {
      const empty = node('div', 'board-empty-search');
      empty.innerHTML = `未找到包含 "<strong>${q}</strong>" 的板块。若知道版面 ID，可直接点击右上角进入。`;
      searchCardsGrid.append(empty);
      return;
    }

    for (const forum of matched) {
      const isCur = String(forum.fid) === curFid;
      const url = forum.url || `/thread.php?fid=${forum.fid}`;
      const card = link(url, '', `board-card${isCur ? ' is-active' : ''}`);

      const mainRow = node('div', 'board-card-main');
      mainRow.append(node('span', 'board-card-name', forum.name));
      if (isCur) mainRow.append(node('span', 'board-card-active-tag', '当前'));
      card.append(mainRow);

      if (forum.desc) card.append(node('div', 'board-card-desc', forum.desc));

      const meta = node('div', 'board-card-meta');
      if (forum.fid) meta.append(node('span', 'board-card-fid', `FID ${forum.fid}`));
      else if (forum.stid) meta.append(node('span', 'board-card-fid', `STID ${forum.stid}`));
      card.append(meta);

      card.addEventListener('click', () => {
        recordRecentBoard({ fid: forum.fid, stid: forum.stid, name: forum.name, url });
        close();
      });

      searchCardsGrid.append(card);
    }
  }

  // 搜索处理
  searchInput.addEventListener('input', () => {
    searchQuery = searchInput.value.trim();
    if (/^-?\d+$/.test(searchQuery)) {
      jumpFidBtn.hidden = false;
      jumpFidBtn.textContent = `进入 FID ${searchQuery} ➔`;
    } else {
      jumpFidBtn.hidden = true;
    }

    if (searchQuery) {
      cardsGrid.replaceChildren();
      splitLayout.hidden = true;
      searchResults.hidden = false;
      testCatTabs.hidden = true;
      renderSearchResults();
    } else {
      searchCardsGrid.replaceChildren();
      splitLayout.hidden = false;
      searchResults.hidden = true;
      testCatTabs.hidden = false;
      renderRightPane();
    }
  });

  searchInput.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      const val = searchInput.value.trim();
      if (/^-?\d+$/.test(val)) jumpToFid(val);
      else {
        const firstCard = (searchQuery ? searchCardsGrid : cardsGrid).querySelector('.board-card');
        if (firstCard) firstCard.click();
      }
    }
  });

  // 手机端顶部把手与标题支持下滑关闭手势
  let startY = 0;
  let currentTranslateY = 0;
  let isDraggingSheet = false;

  for (const trigger of [handle, header]) {
    trigger.addEventListener('touchstart', e => {
      if (e.touches.length !== 1 || e.target.closest('.board-dialog-close, button, input')) return;
      startY = e.touches[0].clientY;
      isDraggingSheet = true;
      sheet.style.transition = 'none';
    }, { passive: true });

    trigger.addEventListener('touchmove', e => {
      if (!isDraggingSheet) return;
      const deltaY = e.touches[0].clientY - startY;
      if (deltaY > 0) {
        if (e.cancelable) e.preventDefault();
        currentTranslateY = deltaY;
        sheet.style.transform = `translateY(${deltaY}px)`;
      }
    }, { passive: false });

    trigger.addEventListener('touchend', () => {
      if (!isDraggingSheet) return;
      isDraggingSheet = false;
      sheet.style.transition = 'transform .2s cubic-bezier(.16, 1, .3, 1)';
      if (currentTranslateY > 80) {
        sheet.style.transform = 'translateY(100%)';
        setTimeout(() => {
          close();
          sheet.style.transform = '';
        }, 160);
      } else {
        sheet.style.transform = '';
      }
      currentTranslateY = 0;
    }, { passive: true });
  }

  dialog.addEventListener('click', event => {
    if (event.target === dialog) close();
  });
  dialog.addEventListener('cancel', () => { close(); });
  dialog.addEventListener('touchmove', event => {
    if (event.target === dialog) {
      if (event.cancelable) event.preventDefault();
    }
  }, { passive: false });
  dialog.addEventListener('wheel', event => {
    if (event.target === dialog) event.preventDefault();
  }, { passive: false });

  let savedDocOverflow = '';
  let savedBodyOverflow = '';
  let savedBodyTouchAction = '';

  function open(initialQuery = '') {
    dialog.dataset.rtTheme = prefs?.theme || 'light';
    app.classList.add('boards-open');
    if (document.documentElement) {
      document.documentElement.setAttribute('data-readscape-modal-open', '');
      savedDocOverflow = document.documentElement.style.overflow;
      document.documentElement.style.overflow = 'hidden';
      document.documentElement.classList.add('rt-boards-locked');
    }
    if (document.body) {
      savedBodyOverflow = document.body.style.overflow;
      savedBodyTouchAction = document.body.style.touchAction;
      document.body.style.overflow = 'hidden';
      document.body.style.touchAction = 'none';
      document.body.classList.add('rt-boards-locked');
    }

    cachedSubforums = extractCurrentSubforums(document, window, pageURL);
    // 如果当前板块有子版块，默认定位到子版
    if (cachedSubforums.length && activeCategoryId !== 'recent') {
      activeCategoryId = 'subforums';
    } else if (activeCategoryId === 'subforums' && !cachedSubforums.length) {
      activeCategoryId = 'recommend';
    }

    // 填充测试兼容容器
    const recent = readRecentBoards();
    testRecentSection.hidden = !recent.length;
    testRecentList.replaceChildren();
    for (const item of recent) {
      const chip = link(item.url, item.name, 'board-chip');
      chip.addEventListener('click', () => { recordRecentBoard(item); close(); });
      testRecentList.append(chip);
    }
    testSubSection.hidden = !cachedSubforums.length;
    testSubList.replaceChildren();
    for (const sub of cachedSubforums) {
      const chip = link(sub.url, sub.name, 'board-chip');
      chip.addEventListener('click', () => { recordRecentBoard(sub); close(); });
      testSubList.append(chip);
    }

    searchInput.value = initialQuery;
    searchQuery = initialQuery;
    jumpFidBtn.hidden = !/^-?\d+$/.test(initialQuery);

    if (searchQuery) {
      cardsGrid.replaceChildren();
      splitLayout.hidden = true;
      searchResults.hidden = false;
      testCatTabs.hidden = true;
      renderSearchResults();
    } else {
      searchCardsGrid.replaceChildren();
      splitLayout.hidden = false;
      searchResults.hidden = true;
      testCatTabs.hidden = false;
      renderSidebar();
      renderRightPane();
    }

    if (typeof dialog.showModal === 'function') {
      try { dialog.showModal(); } catch { dialog.setAttribute('open', ''); dialog.open = true; }
    } else {
      dialog.setAttribute('open', '');
      dialog.open = true;
    }
    searchInput.focus?.();
  }

  function close() {
    // 恢复底层页面滚动
    app.classList.remove('boards-open');
    if (document.documentElement) {
      document.documentElement.removeAttribute('data-readscape-modal-open');
      document.documentElement.style.overflow = savedDocOverflow;
      document.documentElement.classList.remove('rt-boards-locked');
    }
    if (document.body) {
      document.body.style.overflow = savedBodyOverflow;
      document.body.style.touchAction = savedBodyTouchAction;
      document.body.classList.remove('rt-boards-locked');
    }

    if (typeof dialog.close === 'function') {
      try { dialog.close(); } catch { dialog.removeAttribute('open'); dialog.open = false; }
    } else {
      dialog.removeAttribute('open');
      dialog.open = false;
    }
  }

  // 渲染列表页面顶部的子版块横条 (Subforum Strip)
  function renderSubforumStrip(container) {
    if (!container) return;
    const subforums = extractCurrentSubforums(document, window, pageURL);
    cachedSubforums = subforums;
    if (!subforums.length) {
      container.hidden = true;
      return;
    }
    container.hidden = false;
    container.replaceChildren();

    const curFid = pageURL.searchParams.get('fid');
    const curStid = pageURL.searchParams.get('stid');
    const isMainBoard = !curStid;

    // 全部讨论 chip
    const allChip = link(pageURL.pathname + (curFid ? `?fid=${curFid}` : ''), '全部', `subforum-chip${isMainBoard ? ' is-active' : ''}`);
    container.append(allChip);

    for (const sub of subforums) {
      const isCur = (sub.fid && sub.fid === curFid) || (sub.stid && sub.stid === curStid);
      const chip = link(sub.url, sub.name, `subforum-chip${isCur ? ' is-active' : ''}`);
      chip.addEventListener('click', () => { recordRecentBoard(sub); });
      container.append(chip);
    }

    const moreChip = link('/index.php', '更多板块 ↗', 'subforum-chip subforum-chip-more');
    moreChip.target = '_blank';
    moreChip.rel = 'noopener noreferrer';
    moreChip.setAttribute('title', '前往论坛主页查看全部板块（在新页面打开）');
    container.append(moreChip);
  }

  // 从原站首页（forum.php / index.php）DOM 及 window 全局变量中提取板块与分类
  function extractNativeHomepageBoards(doc = document, win = window) {
    const nativeForums = [];
    const seen = new Set();

    const allData = win.__ALL_FORUM_DATA || win.__F;
    if (allData && typeof allData === 'object') {
      for (const [key, val] of Object.entries(allData)) {
        if (!Array.isArray(val) || val.length < 2) continue;
        const rawId = String(val[0] || key);
        const isStid = rawId.startsWith('t') || rawId.startsWith('s') || ((Number(val[4]) & 16) !== 0);
        const cleanId = rawId.replace(/^[ts]/, '');
        const keyStr = isStid ? `stid:${cleanId}` : `fid:${cleanId}`;
        if (seen.has(keyStr)) continue;
        seen.add(keyStr);
        const name = String(val[1] || '').trim();
        const desc = String(val[2] || '').trim();
        if (!name || name.length < 2) continue;
        const url = isStid ? `/thread.php?stid=${cleanId}` : `/thread.php?fid=${cleanId}`;
        nativeForums.push({ fid: isStid ? null : cleanId, stid: isStid ? cleanId : null, name, desc, url });
      }
    }

    const links = doc.querySelectorAll('a[href*="thread.php?fid="], a[href*="thread.php?stid="], #custombg a[href*="thread.php"]');
    for (const a of links) {
      const raw = a.getAttribute('href');
      if (!raw) continue;
      let u;
      try { u = new URL(raw, win.location.href); } catch { continue; }
      const fid = u.searchParams.get('fid');
      const stid = u.searchParams.get('stid');
      if (!fid && !stid) continue;
      const keyStr = stid ? `stid:${stid}` : `fid:${fid}`;
      if (seen.has(keyStr)) continue;
      seen.add(keyStr);
      const name = a.textContent.trim().replace(/^\s*\[.*?\]\s*/, '');
      if (!name || name.length < 2) continue;
      const parentTd = a.closest('td, li, .forum_group, div');
      let desc = '';
      if (parentTd) {
        const descEl = parentTd.querySelector('.desc, .small, .explain, span');
        if (descEl && descEl !== a) desc = descEl.textContent.trim();
      }
      const url = stid ? `/thread.php?stid=${stid}` : `/thread.php?fid=${fid}`;
      nativeForums.push({ fid, stid, name, desc, url });
    }

    return nativeForums;
  }

  // 渲染在 bbs.nga.cn/ 或 forum.php 根首页时的板块导航独立分栏全景视图
  function renderPortalView(mainContainer, emptyContainer) {
    if (emptyContainer) emptyContainer.hidden = true;
    let portal = mainContainer.querySelector('.board-portal-view');
    if (!portal) {
      portal = node('div', 'board-portal-view');
      mainContainer.insertBefore(portal, emptyContainer);
    }
    portal.replaceChildren();

    // 重新解析原版主页中的板块，并与预设分类深度融合
    const nativeForums = extractNativeHomepageBoards(document, window);
    const categories = FORUM_CATEGORIES.map(cat => ({
      id: cat.id,
      name: cat.name,
      icon: cat.icon,
      desc: cat.desc,
      forums: [...cat.forums]
    }));

    const knownFids = new Set();
    for (const cat of categories) {
      for (const f of cat.forums) {
        if (f.fid) knownFids.add(String(f.fid));
      }
    }

    const extraForums = [];
    for (const nf of nativeForums) {
      const idKey = nf.fid ? String(nf.fid) : (nf.stid ? `stid:${nf.stid}` : null);
      if (!idKey || knownFids.has(idKey)) continue;
      knownFids.add(idKey);
      extraForums.push(nf);
    }

    if (extraForums.length > 0) {
      categories.push({
        id: 'native-extra',
        name: '原版其他板块',
        icon: '📂',
        desc: `从当前原版首页解析到的其他 ${extraForums.length} 个版面与合集`,
        forums: extraForums
      });
    }

    // 1. 欢迎全景横幅
    const banner = node('div', 'board-portal-banner');
    const bannerLeft = node('div');
    const bTitle = node('h2', 'board-portal-title', '欢迎使用 阅境 · NGA 版块导航');
    const bSub = node('div', 'board-portal-sub', 'NGA 拥有成百上千个精彩子版块。选择您感兴趣的板块开始沉浸式阅读：');
    bannerLeft.append(bTitle, bSub);

    const bannerActions = node('div', 'board-portal-actions');
    const nativeLink = link('/forum.php', '原版首页 ↗', 'board-portal-native-link');
    nativeLink.dataset.readscapeNative = 'true';
    bannerActions.append(nativeLink);
    banner.append(bannerLeft, bannerActions);
    portal.append(banner);

    // 2. 搜索与直达 FID 栏
    const searchWrap = node('div', 'board-portal-search-wrap');
    const searchIcon = node('span', '', '🔍');
    const searchInput = node('input', 'board-portal-search-input');
    searchInput.type = 'search';
    searchInput.placeholder = '搜索板块名称、描述，或直接输入数字 FID 快速跳转…';
    const jumpFidBtn = button('', 'board-portal-jump-fid', () => {
      const fid = searchInput.value.trim();
      if (fid) location.href = `/thread.php?fid=${fid}`;
    });
    jumpFidBtn.hidden = true;
    searchWrap.append(searchIcon, searchInput, jumpFidBtn);
    portal.append(searchWrap);

    // 3. 分类导航分栏标签条 (Segmented Category Bar)
    const catBar = node('div', 'board-portal-cat-bar');
    let currentFilter = 'all';

    const createCard = (forum) => {
      const targetUrl = forum.url || (forum.stid ? `/thread.php?stid=${forum.stid}` : `/thread.php?fid=${forum.fid}`);
      const card = link(targetUrl, '', 'board-portal-card board-card');

      const topRow = node('div', 'board-portal-card-top board-card-main');
      topRow.append(node('span', 'board-portal-card-name board-card-name', forum.name));
      const fidText = forum.fid ? `FID ${forum.fid}` : (forum.stid ? `STID ${forum.stid}` : '');
      if (fidText) topRow.append(node('span', 'board-portal-card-fid board-card-fid', fidText));
      card.append(topRow);

      if (forum.desc) {
        card.append(node('div', 'board-portal-card-desc board-card-desc', forum.desc));
      }

      card.addEventListener('click', () => {
        recordRecentBoard(forum);
      });
      return card;
    };

    const renderSections = () => {
      sectionsContainer.replaceChildren();
      const query = searchInput.value.trim().toLowerCase();

      // 搜索模式
      if (query) {
        catBar.hidden = true;
        const matched = [];
        const seenFids = new Set();
        for (const cat of categories) {
          for (const forum of cat.forums) {
            const fidStr = String(forum.fid || forum.stid || '');
            if (seenFids.has(fidStr)) continue;
            if (forum.name.toLowerCase().includes(query) || (forum.desc && forum.desc.toLowerCase().includes(query)) || fidStr.includes(query)) {
              seenFids.add(fidStr);
              matched.push(forum);
            }
          }
        }

        const searchSection = node('div', 'board-portal-section');
        const sHead = node('div', 'board-portal-section-header');
        sHead.append(
          node('div', 'board-portal-section-title', `🔍 搜索结果（找到 ${matched.length} 个板块）`)
        );
        searchSection.append(sHead);

        if (!matched.length) {
          const empty = node('div', 'board-empty-search');
          empty.innerHTML = `未找到包含 "<strong>${query}</strong>" 的板块。若知道版面 ID，可直接点击右侧直达按钮。`;
          searchSection.append(empty);
        } else {
          const grid = node('div', 'board-portal-cards-grid board-cards-grid');
          for (const f of matched) {
            grid.append(createCard(f));
          }
          searchSection.append(grid);
        }
        sectionsContainer.append(searchSection);
        return;
      }

      catBar.hidden = false;

      // 最近访问展示（在全部或最近激活时）
      const recent = readRecentBoards();
      if (recent.length && (currentFilter === 'all' || currentFilter === 'recent')) {
        const rSec = node('div', 'board-portal-section board-section-recent');
        const rHead = node('div', 'board-portal-section-header');
        const rTitle = node('div', 'board-portal-section-title', '🕒 最近访问板块');
        const rClear = button('清空历史', 'board-clear-recent', () => {
          clearRecentBoards();
          renderSections();
        });
        rHead.append(rTitle, rClear);
        rSec.append(rHead);

        const rGrid = node('div', 'board-portal-cards-grid board-chips-grid');
        for (const f of recent) {
          rGrid.append(createCard(f));
        }
        rSec.append(rGrid);
        sectionsContainer.append(rSec);
      }

      // 各栏目分栏展示
      for (const cat of categories) {
        if (currentFilter !== 'all' && currentFilter !== cat.id) continue;

        const sec = node('div', 'board-portal-section');
        const sHead = node('div', 'board-portal-section-header board-section-title');
        const sTitleWrap = node('div', 'board-portal-section-title');
        sTitleWrap.append(
          node('span', '', `${cat.icon} ${cat.name}`),
          node('span', 'board-portal-section-count', `${cat.forums.length} 个板块`)
        );
        const sDesc = node('div', 'board-portal-section-desc', cat.desc || '');
        sHead.append(sTitleWrap, sDesc);
        sec.append(sHead);

        const grid = node('div', 'board-portal-cards-grid board-cards-grid');
        for (const forum of cat.forums) {
          grid.append(createCard(forum));
        }
        sec.append(grid);
        sectionsContainer.append(sec);
      }
    };

    // 组织分类导航条按钮
    const catTabs = [{ id: 'all', name: '全部板块', icon: '🌐' }];
    const recent = readRecentBoards();
    if (recent.length) {
      catTabs.push({ id: 'recent', name: '最近访问', icon: '🕒' });
    }
    for (const cat of categories) {
      catTabs.push({ id: cat.id, name: cat.name, icon: cat.icon });
    }

    for (const tabItem of catTabs) {
      const btn = button(`${tabItem.icon} ${tabItem.name}`, `board-portal-cat-btn${tabItem.id === currentFilter ? ' is-active' : ''}`, () => {
        currentFilter = tabItem.id;
        for (const b of catBar.querySelectorAll('.board-portal-cat-btn')) {
          b.classList.toggle('is-active', b === btn);
        }
        renderSections();
      });
      catBar.append(btn);
    }
    portal.append(catBar);

    // 4. 分栏内容总容器
    const sectionsContainer = node('div', 'board-portal-sections');
    portal.append(sectionsContainer);

    // 搜索输入交互
    searchInput.addEventListener('input', () => {
      const val = searchInput.value.trim();
      if (/^-?\d+$/.test(val)) {
        jumpFidBtn.hidden = false;
        jumpFidBtn.textContent = `进入 FID ${val} ➔`;
      } else {
        jumpFidBtn.hidden = true;
      }
      renderSections();
    });

    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const val = searchInput.value.trim();
        if (/^-?\d+$/.test(val)) {
          location.href = `/thread.php?fid=${val}`;
        }
      }
    });

    renderSections();
  }

  return {
    open,
    close,
    dialog,
    FORUM_CATEGORIES,
    FORUM_MAP,
    detectBoardInfo,
    extractCurrentSubforums,
    recordRecentBoard,
    readRecentBoards,
    clearRecentBoards,
    renderSubforumStrip,
    renderPortalView
  };
}
