/**
 * AgroCloudBridge v2.0 · Motor de Sincronización en Tiempo Real
 * Pub/Sub Cloud ($0) vía ntfy.sh + BroadcastChannel + localStorage
 * Conecta instantáneamente:
 *   - Sitio 1: Presentación & Registro (index.html)
 *   - Sitio 2: Plataforma del Agricultor & Tienda (app.html)
 *   - Sitio 3: Panel Super Admin del Equipo (admin.html)
 *   - Sitio 4: Panel Exclusivo ROOT Nivel Dios (root.html)
 */

(function(global){
  const LS_KEY = "agrosuite.state.v2";
  const NTFY_TOPIC = "agroconecta_quillabamba_live_v2";
  const NTFY_URL = "https://ntfy.sh/" + NTFY_TOPIC;
  const CLIENT_ID = "cli_" + Math.random().toString(36).substring(2, 10);
  const TOKEN_KEY = "agroconecta_token";

  // =====================================================================
  //  Backend opcional (Supabase + Render)
  // ---------------------------------------------------------------------
  //  MIENTRAS "url" ESTE VACIO, TODO FUNCIONA EXACTAMENTE COMO ANTES:
  //  el estado vive en el localStorage de cada navegador y la
  //  sincronizacion va por el canal publico de ntfy.sh.
  //
  //  Cuando se llena la URL, el estado pasa a estar en el servidor (una
  //  sola fuente de verdad), las contrasenas se verifican en el servidor
  //  y la sincronizacion usa un canal privado con sesion.
  //
  //  Si el servidor no responde, la web sigue funcionando con el
  //  localStorage: en la chacra no siempre hay senal.
  //
  //  COMO SE ENCIENDE: se pone la URL y se cambia enabled a true.
  //  Ademas hay que poner BACKEND.enabled = true en los tres sitios
  //  (bridge.js es el mismo archivo en los tres).
  // =====================================================================
  const BACKEND = {
    url: "https://agroconecta-backend-n4qe.onrender.com",
    enabled: true
  };

  const listeners = {};

  // ------------------------------------------------------------------
  //  SEGURIDAD · Contrasenas
  //  Las contrasenas jamas se guardan ni se envian en texto plano.
  //  Se guardan como hash SHA-256 y se comparan por hash.
  // ------------------------------------------------------------------
  const DEMO_FARMER_HASH = "1d73a48e4b7289ed82247e75afa1966a04eea918c582c1625b7709988c8f73a5"; // agro123
  const DEFAULT_NEW_ADMIN_HASH = "8d90ed647b948fa80c3c9bbf5316c78f151723f52fb9d6101f818af8afff69ec"; // clave por defecto de admins nuevos (guardada solo como hash)

  async function sha256hex(text){
    try {
      if(window.crypto && window.crypto.subtle && window.TextEncoder){
        const buf = await window.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
        return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,"0")).join("");
      }
    } catch(e){}
    return null; // sin WebCrypto (contexto no seguro): no se expone nada
  }

  function isHash(v){
    return typeof v === "string" && /^[0-9a-f]{64}$/.test(v);
  }

  // Compara una contrasena con lo guardado (hash nuevo o plano antiguo).
  async function verifyPassword(input, stored){
    if(!stored) return false;
    if(isHash(stored)){
      const h = await sha256hex(input);
      return h !== null && h === stored;
    }
    // Compatibilidad con registros antiguos guardados en texto plano
    return stored === input;
  }

  // Elimina cualquier credencial EN TEXTO PLANO de lo que se manda por la red.
  // Los hashes (passwordHash / passHash) si viajan, para que el inicio de
  // sesion siga funcionando en otros dispositivos.
  function stripSecrets(obj){
    if(obj === null || typeof obj !== "object") return obj;
    if(Array.isArray(obj)) return obj.map(stripSecrets);
    const out = {};
    Object.keys(obj).forEach(k => {
      if(k === "password" || k === "pass") return;
      out[k] = stripSecrets(obj[k]);
    });
    return out;
  }

  // Migra contrasenas antiguas en texto plano a hash (una sola vez).
  async function migrateSecrets(){
    let s;
    try { s = JSON.parse(localStorage.getItem(LS_KEY) || "null"); } catch(e){ return; }
    if(!s) return;
    let dirty = false;
    if(Array.isArray(s.farmers)){
      for(const f of s.farmers){
        if(f.password && !f.passwordHash){
          f.passwordHash = (await sha256hex(f.password)) || f.password;
          delete f.password;
          dirty = true;
        }
        if(!f.passwordHash) f.passwordHash = DEMO_FARMER_HASH;
      }
    }
    if(Array.isArray(s.admins)){
      for(const a of s.admins){
        if(a.pass && !a.passHash){
          a.passHash = (await sha256hex(a.pass)) || a.pass;
          delete a.pass;
          dirty = true;
        }
      }
    }
    if(dirty){
      try { localStorage.setItem(LS_KEY, JSON.stringify(s)); } catch(e){}
    }
  }

  const DEFAULT_STATE = {
    version: "2.0",
    theme: "dark",
    lang: "es",
    globalAnnouncement: null,
    masterCodes: ["AGRO26", "QUILLA", "VALLE1", "CACAO8"],
    currentFarmerId: "farmer-01",
    marketPrices: [
      { id: "p1", crop: "Palta Fuerte y Hass Selecta", price: "S/ 6.50 - S/ 8.40", unit: "por kg", trend: "up", trendLabel: "▲ +S/ 0.60", note: "Gran demanda para mercado mayorista y exportación" },
      { id: "p2", crop: "Cítricos: Naranja Valencia y Mandarina", price: "S/ 26.00 - S/ 32.00", unit: "ciento (100 u)", trend: "stable", trendLabel: "Estable", note: "Mercados centrales y distribución regional" },
      { id: "p3", crop: "Plátano Isla / Seda / Bellaco", price: "S/ 24.00 - S/ 30.00", unit: "por racimo", trend: "up", trendLabel: "▲ +S/ 1.20", note: "Alta rotación en abastos y distribuidores" },
      { id: "p4", crop: "Kión / Jengibre y Cúrcuma Orgánica", price: "S/ 6.50 - S/ 8.00", unit: "por kg", trend: "up", trendLabel: "▲ +S/ 0.50", note: "Cosecha fresca seleccionada sin químicos" },
      { id: "p5", crop: "Hortalizas y Tomate de Chacra", price: "S/ 3.20 - S/ 4.50", unit: "por kg", trend: "stable", trendLabel: "Estable", note: "Venta directa a verdulerías y familias" },
      { id: "p6", crop: "Papa Nativa y Yuca de Valle", price: "S/ 2.50 - S/ 3.80", unit: "por kg", trend: "stable", trendLabel: "Estable", note: "Abastecimiento local y regional" },
      { id: "p7", crop: "Café Pergamino Especial (84+ pts)", price: "S/ 16.80 - S/ 18.50", unit: "por kg", trend: "up", trendLabel: "▲ +S/ 0.80", note: "Gran demanda exportación y barismo" },
      { id: "p8", crop: "Cacao Chuncho Nativo Fino de Aroma", price: "S/ 22.00 - S/ 25.50", unit: "por kg", trend: "up", trendLabel: "⭐ Récord Histórico", note: "Chocolatería artesanal y europea" },
      { id: "p9", crop: "Granos: Maíz Amarillo y Menestras", price: "S/ 3.80 - S/ 5.20", unit: "por kg", trend: "stable", trendLabel: "Estable", note: "Granos secos listos para almacenamiento" },
      { id: "p10", crop: "Miel Pura de Abeja Silvestre", price: "S/ 25.00 - S/ 32.00", unit: "por kg", trend: "up", trendLabel: "▲ +S/ 1.00", note: "Frascos certificados cosecha de bosque" }
    ],
    farmers: [
      {
        id: "farmer-01",
        name: "Diego Cárdenas",
        username: "diego",
        chacra: "Fundo AgroEcológico Buena Vista",
        email: "diego@agroconecta.pe",
        passwordHash: "1d73a48e4b7289ed82247e75afa1966a04eea918c582c1625b7709988c8f73a5",
        phone: "+51 984 123 456",
        cultivo: "Frutas, Hortalizas y Café",
        variedad: "Paltas Hass, Cítricos, Tomates y Café Geisha",
        zona: "Quillabamba, Cusco",
        distrito: "Santa Ana",
        altura: "1,250 msnm",
        registered: true,
        online: true,
        plan: "demo",
        demoExpires: Date.now() + 24 * 3600 * 1000,
        sketchesLeft: 3,
        allowPublicReserve: true,
        cover: "https://images.unsplash.com/photo-1509042239860-f550ce710b93?auto=format&fit=crop&w=1400&q=80",
        historia: "Fundo agrícola familiar diversificado en 3 generaciones, cultivando frutas de temporada, hortalizas frescas de huerto y café especial con manejo sostenible.",
        parcelLots: [
          { id: 1, name: "Lote Las Paltas", variety: "Palta Hass y Fuerte", process: "Cosecha Fresca", plants: 850, yield: "12 TN", price: 35, status: "Disponible", allowReserve: true },
          { id: 2, name: "Lote Los Cítricos", variety: "Naranja Valencia y Mandarina", process: "Fruta de Árbol", plants: 1100, yield: "250 cientos", price: 28, status: "Disponible", allowReserve: true },
          { id: 3, name: "Lote Huerta Verde", variety: "Tomates y Hortalizas", process: "Orgánico", plants: 2400, yield: "350 jabas", price: 25, status: "Disponible", allowReserve: true },
          { id: 4, name: "Lote El Manantial", variety: "Plátano y Yuca", process: "Cosecha Seleccionada", plants: 900, yield: "400 racimos", price: 26, status: "Disponible", allowReserve: true },
          { id: 5, name: "Lote Raíces Vivas", variety: "Kión y Cúrcuma", process: "Lavado y Secado", plants: 1500, yield: "2500 kg", price: 32, status: "Disponible", allowReserve: true },
          { id: 6, name: "Lote Café Geisha", variety: "Café Especial de Altura", process: "Lavado", plants: 1200, yield: "18 qq", price: 45, status: "Disponible", allowReserve: true }
        ],
        crm: [
          { id: "c1", name: "Carlos Distribuidor Frutas", phone: "+51 984 777 111", tag: "cliente", note: "Pide 50 jabas de palta y naranja quincenal" },
          { id: "c2", name: "Cooperativa Agropecuaria", phone: "+51 984 888 222", tag: "mayorista", note: "Comprador de productos agrícolas en volumen" },
          { id: "c3", name: "BioInsumos Valle", phone: "+51 984 999 333", tag: "proveedor", note: "Compost orgánico y biofertilizantes" }
        ],
        legalStatus: { ruc: true, digesa: true, indecopi: false }
      },
      {
        id: "farmer-02",
        name: "Melchor Huamán",
        username: "melchor",
        chacra: "Fundo Los Frutales del Chuncho",
        email: "melchor@quillabamba.pe",
        passwordHash: "1d73a48e4b7289ed82247e75afa1966a04eea918c582c1625b7709988c8f73a5",
        phone: "+51 984 555 123",
        cultivo: "Frutas Tropicales y Cacao",
        variedad: "Mangos, Papayas, Plátanos y Cacao Chuncho",
        zona: "Maranura, Cusco",
        distrito: "Maranura",
        altura: "850 msnm",
        registered: true,
        online: true,
        plan: "plan30",
        demoExpires: Date.now() + 30 * 24 * 3600 * 1000,
        sketchesLeft: 3,
        allowPublicReserve: true,
        cover: "https://images.unsplash.com/photo-1610450949065-1f2841536c88?auto=format&fit=crop&w=1400&q=80",
        historia: "Producción agrícola tropical combinando frutales dulces de valle y cacao nativo fino de aroma.",
        parcelLots: [
          { id: 1, name: "Lote Frutales Tropicales", variety: "Mangos y Plátano Isla", process: "Cosecha Lista", plants: 800, yield: "15 TN", price: 30, status: "Disponible", allowReserve: true },
          { id: 2, name: "Lote Cacao Chuncho", variety: "Cacao Nativo Selección", process: "Fermentado", plants: 700, yield: "1000 kg", price: 42, status: "Disponible", allowReserve: true }
        ],
        crm: [],
        legalStatus: { ruc: true, digesa: true, indecopi: true }
      },
      {
        id: "farmer-03",
        name: "Rosa Almirón",
        username: "rosa",
        chacra: "Huerto Agropecuario Los Cedros",
        email: "rosa@quillabamba.pe",
        passwordHash: "1d73a48e4b7289ed82247e75afa1966a04eea918c582c1625b7709988c8f73a5",
        phone: "+51 984 777 888",
        cultivo: "Hortalizas, Tubérculos y Especias",
        variedad: "Papa Nativa, Yuca, Hortalizas y Kión",
        zona: "Huayopata, Cusco",
        distrito: "Huayopata",
        altura: "1,520 msnm",
        registered: true,
        online: false,
        plan: "plan30",
        demoExpires: Date.now() + 30 * 24 * 3600 * 1000,
        sketchesLeft: 3,
        allowPublicReserve: false,
        cover: "https://images.unsplash.com/photo-1524350876685-274059332603?auto=format&fit=crop&w=1400&q=80",
        historia: "Agricultura limpia de alta fertilidad, cosechando alimentos sanos directo del campo a la mesa del consumidor.",
        parcelLots: [],
        crm: [],
        legalStatus: { ruc: true, digesa: false, indecopi: false }
      },
      {
        id: "farmer-04",
        name: "Juan de Dios Paucar",
        username: "juan",
        chacra: "AgroFundo Yanatile",
        email: "juan@quillabamba.pe",
        passwordHash: "1d73a48e4b7289ed82247e75afa1966a04eea918c582c1625b7709988c8f73a5",
        phone: "+51 984 333 444",
        cultivo: "Granos Andinos, Maíz y Miel",
        variedad: "Maíz Blanco, Frijoles y Miel Silvestre",
        zona: "Quellouno, Cusco",
        distrito: "Quellouno",
        altura: "980 msnm",
        registered: true,
        online: true,
        plan: "demo",
        demoExpires: Date.now() + 12 * 3600 * 1000,
        sketchesLeft: 2,
        allowPublicReserve: true,
        cover: "https://images.unsplash.com/photo-1518057111178-44a106bad636?auto=format&fit=crop&w=1400&q=80",
        historia: "Tradición campesina en granos andinos y apicultura silvestre en las laderas de Yanatile.",
        parcelLots: [],
        crm: [],
        legalStatus: { ruc: false, digesa: false, indecopi: false }
      }
    ],
    admins: [
      {
        id: "root-01",
        name: "Diego (Fundador)",
        user: "diego",
        email: "diego.root@agroconecta.pe",
        passHash: "28ce562658ab04a34db5f00cef3a029290ae3212f242b40883721203df4ac4a0",
        role: "ROOT",
        cargo: "Fundador & Arquitecto General",
        status: "active",
        createdAt: "2026-11-01T00:00:00Z"
      },
      {
        id: "admin-01",
        name: "Carlos Mendoza",
        user: "carlos",
        email: "carlos.admin@agroconecta.pe",
        passHash: "bfd0b819c877221e3c3ed64c9b5da4e05842448341f18dd4d111b187532eda1f",
        role: "Super Admin",
        cargo: "Coordinador de Chacras y Tostado",
        status: "active",
        createdAt: "2026-11-02T10:00:00Z"
      },
      {
        id: "admin-02",
        name: "María Quispe",
        user: "maria",
        email: "maria.admin@agroconecta.pe",
        passHash: "7324b614ca5cb7795ee21d14f238aae18a71ae51659aa5958b219dda7ac56ca8",
        role: "Super Admin",
        cargo: "Especialista Legal & Certificaciones",
        status: "active",
        createdAt: "2026-11-02T11:00:00Z"
      }
    ],
    auditLogs: [
      { id: "log-1", adminName: "Diego (ROOT)", action: "INICIALIZACIÓN", target: "Plataforma AgroConecta v2.0", time: new Date(Date.now() - 3600000).toLocaleTimeString("es-PE") },
      { id: "log-2", adminName: "Carlos Mendoza", action: "ACTIVACIÓN", target: "Finca El Chuncho Dorado (Plan 30d)", time: new Date(Date.now() - 1800000).toLocaleTimeString("es-PE") }
    ],
    supportChats: [
      { id: "msg-1", farmerId: "farmer-01", farmerName: "Chacra Buena Vista", sender: "farmer", text: "Hola equipo, necesito ayuda para registrar mi marca en INDECOPI", time: "08:15" },
      { id: "msg-2", farmerId: "farmer-01", farmerName: "Chacra Buena Vista", sender: "admin", adminName: "María Quispe", text: "¡Hola Diego! Ya te cargamos la plantilla de búsqueda fonética en tu Módulo 07.", time: "08:18" }
    ]
  };

  // =====================================================================
  //  Migracion de contenido (semilla)
  // ---------------------------------------------------------------------
  //  POR QUE ESTO EXISTE
  //  ------------------
  //  El estado de cada persona vive en su propio navegador (localStorage).
  //  Cuando ya existe, loadState() lo devolvia tal cual, asi que cambiar
  //  DEFAULT_STATE NO llegaba nunca a quien ya habia visitado la web:
  //  su navegador seguia mostrando la version vieja para siempre.
  //  (Por eso la pizarra de precios seguia con 6 productos de cafe y
  //  cacao despues de haberla actualizado a 10 productos.)
  //
  //  COMO FUNCIONA
  //  -------------
  //  Cada vez que cambies el contenido de demostracion (precios, fichas
  //  de los productores de ejemplo, datos de los admins) sube el numero
  //  SEED_VERSION. La primera vez que un usuario abre la web, su
  //  contenido se actualiza al nuevo.
  //
  //  LO QUE NO SE TOCA (lo que el equipo haya modificado)
  //    - Un precio editado por el admin (lleva edited === true).
  //    - El plan, el estado, el CRM y los datos legales de cada
  //      productor.
  //    - Un lote ya reservado sigue apareciendo como reservado.
  //    - Los productores y admins reales NO se tocan.
  // =====================================================================
  const SEED_VERSION = 2;

  // El correo viejo del contenido semilla se reconoce y se actualiza.
  // Cualquier otro correo es del equipo y se respeta.
  function esCorreoSemilla(v){
    return typeof v === "string" && /@agrosuite\.pe$/i.test(v.trim());
  }

  function refrescarSemilla(s){
    // Si el estado viene ACOTADO a un productor (el servidor asi lo
    // envia), NO se siembra nada: aqui solo esta su ficha y los datos
    // compartidos. Si se sembrara, se le volverian a meter todos los
    // productores de ejemplo y todos los admins.
    if(s.scope === "farmer") return;

    // --- Precios del mercado ---
    // Se comparan por NOMBRE de producto, no por id: al actualizarse la
    // semilla un mismo id puede pasar a significar otra cosa (p1 era cafe
    // y ahora es palta). Comparar por nombre deja que la edicion del
    // admin siga pegada al producto que el edito de verdad.
    const normalizar = t => (t || "").toString().toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();

    const previos = Array.isArray(s.marketPrices) ? s.marketPrices : [];
    const porNombre = {};
    previos.forEach(x => { porNombre[normalizar(x.crop)] = x; });

    const precios = DEFAULT_STATE.marketPrices.map(dp => {
      const previo = porNombre[normalizar(dp.crop)];
      if(previo && previo.edited === true) {
        // El admin cambio este producto: se respeta su precio.
        return Object.assign({}, JSON.parse(JSON.stringify(dp)), {
          price: previo.price, trend: previo.trend, trendLabel: previo.trendLabel
        });
      }
      return JSON.parse(JSON.stringify(dp));
    });

    // Los productos que el admin agrego aparte se conservan.
    const nombresSemilla = {};
    DEFAULT_STATE.marketPrices.forEach(dp => { nombresSemilla[normalizar(dp.crop)] = true; });
    previos.forEach(x => {
      if(!nombresSemilla[normalizar(x.crop)] && x.edited === true) precios.push(x);
    });
    s.marketPrices = precios;

    // --- Fichas de los productores ---
    const demo = {};
    DEFAULT_STATE.farmers.forEach(f => { demo[f.id] = f; });

    s.farmers = s.farmers.map(f => {
      const d = demo[f.id];
      if(!d) return f;   // productor real: no se toca
      const copia = JSON.parse(JSON.stringify(d));
      // Lo que el equipo haya cambiado se respeta.
      ["passwordHash","password","status","plan","demoExpires","online",
       "registered","crm","legalStatus","sketchesLeft","allowPublicReserve",
       "phone"].forEach(k => {
        if(f[k] !== undefined) copia[k] = f[k];
      });
      // El correo de la semilla vieja si actualiza; el del equipo se respeta.
      if(!f.email || esCorreoSemilla(f.email)) copia.email = d.email;
      else copia.email = f.email;
      // Los lotes se refrescan, pero un lote ya reservado sigue reservado.
      copia.parcelLots = (d.parcelLots || []).map(nuevo => {
        const viejo = (f.parcelLots || []).find(x => x.id === nuevo.id);
        if(viejo && viejo.status && viejo.status !== "Disponible"){
          return Object.assign({}, nuevo, { status: viejo.status, allowReserve: viejo.allowReserve });
        }
        return nuevo;
      });
      return copia;
    });

    // Productores de demostracion que falten (si se anadio uno nuevo).
    DEFAULT_STATE.farmers.forEach(d => {
      if(!s.farmers.some(f => f.id === d.id)) s.farmers.push(JSON.parse(JSON.stringify(d)));
    });

    // --- Admins ---
    const adminsDemo = {};
    DEFAULT_STATE.admins.forEach(a => { adminsDemo[a.id] = a; });
    s.admins = s.admins.map(a => {
      const d = adminsDemo[a.id];
      if(!d) return a;   // admin creado desde el panel: no se toca
      const copia = JSON.parse(JSON.stringify(d));
      ["passHash","pass","status"].forEach(k => {
        if(a[k] !== undefined) copia[k] = a[k];
      });
      if(!a.email || esCorreoSemilla(a.email)) copia.email = d.email;
      else copia.email = a.email;
      return copia;
    });
    DEFAULT_STATE.admins.forEach(d => {
      if(!s.admins.some(a => a.id === d.id)) s.admins.push(JSON.parse(JSON.stringify(d)));
    });
  }

  // =====================================================================
  //  Backend · acceso al servidor
  // ---------------------------------------------------------------------
  //  Estas funciones son la UNICA forma en que el navegador habla con
  //  el servidor. Si BACKEND.enabled es false, no se usan nunca y la web
  //  se comporta exactamente como antes.
  // =====================================================================
  let backendVersion = 0;

  function backendToken(){
    try { return sessionStorage.getItem(TOKEN_KEY) || ""; } catch(e){ return ""; }
  }

  function guardarToken(t){
    try {
      if(t) sessionStorage.setItem(TOKEN_KEY, t);
      else sessionStorage.removeItem(TOKEN_KEY);
    } catch(e){}
  }

  // El rol de quien esta conectado, leido del token firmado.
  function rolDeLaSesion(){
    const t = backendToken();
    if(!t) return null;
    try {
      const partes = t.split(".");
      const crudo = atob(partes[0].replace(/-/g, "+").replace(/_/g, "/"));
      return JSON.parse(crudo).role || null;
    } catch(e){ return null; }
  }

  function sesionDeEquipo(){
    const r = rolDeLaSesion();
    return r === "ROOT" || r === "ADMIN";
  }

  async function api(ruta, opciones){
    if(!BACKEND.enabled || !BACKEND.url) return { ok:false, sinServidor:true };
    const cabeceras = { "Content-Type": "application/json" };
    const t = backendToken();
    if(t) cabeceras.Authorization = "Bearer " + t;
    try {
      const r = await fetch(BACKEND.url + ruta, {
        method: (opciones && opciones.method) || "GET",
        headers: cabeceras,
        body: (opciones && opciones.body) ? JSON.stringify(opciones.body) : undefined
      });
      let datos = null;
      try { datos = await r.json(); } catch(e){}
      return { ok: r.ok, status: r.status, datos: datos };
    } catch(e){
      // Servidor caido o sin senal: se sigue con el modo local.
      return { ok:false, sinServidor:true, error: e.message };
    }
  }

  // Trae el estado del servidor y lo deja tambien en el cache local.
  async function refrescarDelBackend(){
    const token = backendToken();
    const r = await api(token ? "/api/state" : "/api/publico");
    if(!r.ok || !r.datos) return null;

    if(token){
      // Con sesion: el estado completo (acotado al rol).
      backendVersion = r.datos.version || 0;
      try { localStorage.setItem(LS_KEY, JSON.stringify(r.datos.state)); } catch(e){}
      currentState = r.datos.state;
      dispatchLocal("STATE_CHANGED", currentState);
      return r.datos.state;
    }

    // Sin sesion (la portada): solo se actualizan los datos publicos.
    // El resto del estado local se queda como esta.
    const s = loadState();
    if(Array.isArray(r.datos.marketPrices)) s.marketPrices = r.datos.marketPrices;
    if(r.datos.globalAnnouncement !== undefined) s.globalAnnouncement = r.datos.globalAnnouncement;
    backendVersion = r.datos.version || backendVersion;
    try { localStorage.setItem(LS_KEY, JSON.stringify(s)); } catch(e){}
    currentState = s;
    dispatchLocal("STATE_CHANGED", s);
    return s;
  }

  // Envia el estado al servidor. No se espera: la pantalla ya va en local.
  async function guardarEnBackend(state){
    const r = await api("/api/state", {
      method: "PUT",
      body: { state: state, baseVersion: backendVersion }
    });
    if(r.status === 409){
      // Alguien guardo antes que nosotros: se recarga lo del servidor.
      await refrescarDelBackend();
    } else if(r.ok && r.datos){
      backendVersion = r.datos.version || backendVersion;
    }
    return r;
  }

  async function loginEnBackend(user, password){
    const r = await api("/api/auth/login", {
      method: "POST",
      body: { user: user, password: password }
    });
    if(r.sinServidor) return { sinServidor:true };
    if(!r.ok){
      return {
        success: false,
        error: (r.datos && r.datos.error) || "Credenciales incorrectas.",
        suspended: !!(r.datos && r.datos.suspended)
      };
    }
    guardarToken(r.datos.token);
    return { success:true, usuario: r.datos.user };
  }

  function loadState(){
    try {
      const raw = localStorage.getItem(LS_KEY);
      if(!raw) {
        const inicial = JSON.parse(JSON.stringify(DEFAULT_STATE));
        inicial.seedVersion = SEED_VERSION;
        localStorage.setItem(LS_KEY, JSON.stringify(inicial));
        return inicial;
      }
      const s = JSON.parse(raw);
      // Validar integridad mínima
      if(!s.farmers || !s.admins) {
        const merged = Object.assign({}, DEFAULT_STATE, s);
        localStorage.setItem(LS_KEY, JSON.stringify(merged));
        return merged;
      }
      // Asegurar que cada agricultor cuente con su contraseña
      if(Array.isArray(s.farmers)){
        s.farmers.forEach(f => {
          if(!f.passwordHash && !f.password) f.passwordHash = DEMO_FARMER_HASH;
        });
      }
      if(!s.marketPrices || !Array.isArray(s.marketPrices)){
        s.marketPrices = DEFAULT_STATE.marketPrices;
      }
      // Migracion de contenido: sin esto, una actualizacion del sitio
      // nunca llega a quien ya lo habia visitado.
      if((s.seedVersion || 1) < SEED_VERSION){
        refrescarSemilla(s);
        s.seedVersion = SEED_VERSION;
        try { localStorage.setItem(LS_KEY, JSON.stringify(s)); } catch(e){}
      }
      return s;
    } catch(e) {
      console.warn("[AgroCloudBridge] Fallback a estado predeterminado:", e);
      return JSON.parse(JSON.stringify(DEFAULT_STATE));
    }
  }

  let currentState = loadState();

  function saveState(newState, broadcastEvent){
    currentState = newState;
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(currentState));
    } catch(e){}

    // Con el backend encendido, el estado tambien se manda al servidor
    // (sin esperar: la pantalla ya va en local).
    if(BACKEND.enabled && sesionDeEquipo()){
      guardarEnBackend(newState);
    }

    if(broadcastEvent){
      publish(broadcastEvent.type, broadcastEvent.data);
    }
  }

  // Canal de difusión local
  let bc = null;
  if(typeof BroadcastChannel !== "undefined"){
    try {
      bc = new BroadcastChannel("agro_sync");
      bc.onmessage = function(e){
        if(e.data && e.data.sender !== CLIENT_ID){
          handleIncomingPacket(e.data);
        }
      };
    } catch(e){}
  }

  // Cross-tab storage fallback
  window.addEventListener("storage", function(e){
    if(e.key === LS_KEY && e.newValue){
      try {
        currentState = JSON.parse(e.newValue);
        dispatchLocal("STATE_CHANGED", currentState);
      } catch(err){}
    }
  });

  // EventSource en vivo (Pub/Sub Cloud vía ntfy.sh)
  let sse = null;
  function connectSSE(){
    // Con el backend encendido, la sincronizacion va por el canal
    // PRIVADO del servidor (con sesion) en vez del canal publico.
    if(BACKEND.enabled && BACKEND.url){
      const t = backendToken();
      if(!t){ setTimeout(connectSSE, 6000); return; }
      try {
        if(sse) sse.close();
        sse = new EventSource(BACKEND.url + "/api/events?token=" + encodeURIComponent(t));
        sse.addEventListener("estado", function(){
          refrescarDelBackend();
        });
        sse.onerror = function(){
          if(sse) sse.close();
          setTimeout(connectSSE, 4500);
        };
      } catch(err){
        setTimeout(connectSSE, 6000);
      }
      return;
    }
    try {
      if(sse) sse.close();
      sse = new EventSource(NTFY_URL + "/sse");
      sse.onmessage = function(e){
        try {
          const raw = JSON.parse(e.data);
          if(raw && raw.message){
            const packet = JSON.parse(raw.message);
            if(packet && packet.sender !== CLIENT_ID){
              handleIncomingPacket(packet);
            }
          }
        } catch(err){}
      };
      sse.onerror = function(){
        if(sse) sse.close();
        setTimeout(connectSSE, 4500);
      };
    } catch(err){
      setTimeout(connectSSE, 6000);
    }
  }

  function handleIncomingPacket(packet){
    if(!packet || !packet.type) return;
    
    // Si el paquete trae actualización de estado o mutación
    applyStateMutation(packet.type, packet.data);
    
    // Notificar suscriptores locales
    dispatchLocal(packet.type, packet.data);
    dispatchLocal("*", packet);
  }

  function applyStateMutation(type, data){
    const s = loadState();
    let changed = false;

    if(type === "FARMER_STATUS_CHANGE" && data && data.id){
      const f = s.farmers.find(x => x.id === data.id);
      if(f){
        f.online = !!data.online;
        changed = true;
      }
    } else if(type === "FARMER_REGISTERED" && data){
      const idx = s.farmers.findIndex(x => x.id === data.id);
      if(idx >= 0){
        s.farmers[idx] = Object.assign({}, s.farmers[idx], data);
      } else {
        s.farmers.unshift(data);
      }
      changed = true;
    } else if(type === "FARMER_PAUSED" && data && data.id){
      const f = s.farmers.find(x => x.id === data.id);
      if(f){
        f.plan = "paused";
        changed = true;
      }
    } else if(type === "FARMER_ACTIVATED" && data && data.id){
      const f = s.farmers.find(x => x.id === data.id);
      if(f){
        f.plan = "plan30";
        f.demoExpires = Date.now() + 30 * 24 * 3600 * 1000;
        changed = true;
      }
    } else if(type === "FARMER_EXTEND_DEMO" && data && data.id){
      const f = s.farmers.find(x => x.id === data.id);
      if(f){
        f.plan = "demo";
        const base = (f.demoExpires && f.demoExpires > Date.now()) ? f.demoExpires : Date.now();
        f.demoExpires = base + (data.hours || 24) * 3600 * 1000;
        changed = true;
      }
    } else if(type === "FARMER_RESET_SKETCHES" && data && data.id){
      const f = s.farmers.find(x => x.id === data.id);
      if(f){
        f.sketchesLeft = 3;
        changed = true;
      }
    } else if(type === "ADMIN_SUSPENDED" && data && data.id){
      const a = s.admins.find(x => x.id === data.id);
      if(a){
        a.status = "suspended";
        changed = true;
      }
    } else if(type === "ADMIN_ACTIVATED" && data && data.id){
      const a = s.admins.find(x => x.id === data.id);
      if(a){
        a.status = "active";
        changed = true;
      }
    } else if(type === "ADMIN_CREATED" && data){
      s.admins.push(data);
      changed = true;
    } else if(type === "ADMIN_DELETED" && data && data.id){
      s.admins = s.admins.filter(x => x.id !== data.id);
      changed = true;
    } else if(type === "CHAT_MESSAGE" && data){
      s.supportChats.push(data);
      changed = true;
    } else if(type === "GLOBAL_ANNOUNCEMENT"){
      s.globalAnnouncement = data.message;
      changed = true;
    } else if(type === "AUDIT_LOG" && data){
      s.auditLogs.unshift(data);
      if(s.auditLogs.length > 50) s.auditLogs.pop();
      changed = true;
    }

    if(changed){
      currentState = s;
      try {
        localStorage.setItem(LS_KEY, JSON.stringify(s));
      } catch(e){}
      dispatchLocal("STATE_CHANGED", s);
    }
  }

  function dispatchLocal(type, data){
    if(listeners[type]){
      listeners[type].forEach(fn => {
        try { fn(data); } catch(err){ console.error(err); }
      });
    }
  }

  function publish(type, data){
    const packet = {
      type: type,
      data: stripSecrets(data),
      sender: CLIENT_ID,
      timestamp: Date.now()
    };

    // 1. Aplicar localmente de inmediato
    applyStateMutation(type, data);
    dispatchLocal(type, data);
    dispatchLocal("*", packet);

    // 2. Enviar por BroadcastChannel (mismo navegador, instantáneo)
    if(bc){
      try { bc.postMessage(packet); } catch(e){}
    }

    // 3. Enviar a Cloud Pub/Sub ntfy.sh (para celulares y PCs en red externa)
    //    Con el backend encendido NO se usa: el canal publico es el
    //    problema que el backend viene a resolver. La sincronizacion la
    //    hace el canal privado (SSE) del servidor.
    if(BACKEND.enabled) return;
    try {
      fetch(NTFY_URL, {
        method: "POST",
        headers: { "Title": "agro_event" },
        body: JSON.stringify(packet)
      }).catch(() => {});
    } catch(e){}
  }

  function on(type, fn){
    if(!listeners[type]) listeners[type] = [];
    listeners[type].push(fn);
  }

  function off(type, fn){
    if(!listeners[type]) return;
    listeners[type] = listeners[type].filter(f => f !== fn);
  }

  // Iniciar conexión en tiempo real
  if(typeof window !== "undefined"){
    setTimeout(connectSSE, 200);
    // Con el backend encendido, lo primero es traerse el estado del
    // servidor (el local queda solo como cache y para trabajar sin señal).
    if(BACKEND.enabled && BACKEND.url){
      setTimeout(function(){ refrescarDelBackend(); }, 100);
    }
  }

  // API pública de AgroCloudBridge
  const API = {
    CLIENT_ID,
    LS_KEY,
    getState: function(){ return loadState(); },
    saveState: saveState,
    publish: publish,
    on: on,
    off: off,

    // --- Backend (Supabase + Render) ---
    // usarBackend() dice si el servidor esta encendido. Las pantallas lo
    // consultan para decidir si guardan en el navegador o en el servidor.
    usarBackend: function(){ return !!(BACKEND.enabled && BACKEND.url); },
    backendUrl: function(){ return BACKEND.url; },
    refrescarDelBackend: function(){ return refrescarDelBackend(); },
    cerrarSesionBackend: function(){
      guardarToken("");
      backendVersion = 0;
    },

    // --- Seguridad / contrasenas ---
    hashPassword: function(pwd){ return sha256hex(pwd); },
    verifyPassword: function(input, stored){ return verifyPassword(input, stored); },
    migrateSecrets: function(){ return migrateSecrets(); },
    
    // Operaciones con Agricultores
    getMarketPrices: function(){
      const s = loadState();
      return s.marketPrices || DEFAULT_STATE.marketPrices;
    },
    updateMarketPrice: function(id, price, trend, trendLabel){
      const s = loadState();
      if(!s.marketPrices) s.marketPrices = DEFAULT_STATE.marketPrices;
      const item = s.marketPrices.find(x => x.id === id);
      if(item){
        if(price) item.price = price;
        if(trend) item.trend = trend;
        if(trendLabel) item.trendLabel = trendLabel;
        // Marca de "editado por el equipo": la migracion de semilla respeta
        // este precio y no lo vuelve a poner como estaba en el ejemplo.
        item.edited = true;
        saveState(s, { type: "PRICES_UPDATED", data: s.marketPrices });
      }
    },
    getCurrentFarmer: function(){
      const s = loadState();
      return s.farmers.find(x => x.id === s.currentFarmerId) || s.farmers[0];
    },
    setCurrentFarmerId: function(id){
      const s = loadState();
      s.currentFarmerId = id;
      saveState(s);
    },
    saveFarmerProfile: function(farmerData){
      const s = loadState();
      const idx = s.farmers.findIndex(x => x.id === farmerData.id);
      if(idx >= 0){
        s.farmers[idx] = Object.assign({}, s.farmers[idx], farmerData);
      } else {
        s.farmers.unshift(farmerData);
      }
      s.currentFarmerId = farmerData.id;
      saveState(s, { type: "FARMER_REGISTERED", data: farmerData });
    },
    toggleFarmerOnline: function(id, online){
      const s = loadState();
      const f = s.farmers.find(x => x.id === id);
      if(f){
        f.online = !!online;
        saveState(s, { type: "FARMER_STATUS_CHANGE", data: { id, online: f.online } });
      }
    },
    pauseFarmer: function(id, adminName){
      const s = loadState();
      const f = s.farmers.find(x => x.id === id);
      if(f){
        f.plan = "paused";
        const log = { id: "log-" + Date.now(), adminName, action: "PAUSA", target: f.chacra, time: new Date().toLocaleTimeString("es-PE") };
        s.auditLogs.unshift(log);
        saveState(s, { type: "FARMER_PAUSED", data: { id, adminName } });
        publish("AUDIT_LOG", log);
      }
    },
    activateFarmer: function(id, adminName){
      const s = loadState();
      const f = s.farmers.find(x => x.id === id);
      if(f){
        f.plan = "plan30";
        f.demoExpires = Date.now() + 30 * 24 * 3600 * 1000;
        const log = { id: "log-" + Date.now(), adminName, action: "ACTIVACIÓN 30D", target: f.chacra, time: new Date().toLocaleTimeString("es-PE") };
        s.auditLogs.unshift(log);
        saveState(s, { type: "FARMER_ACTIVATED", data: { id, adminName } });
        publish("AUDIT_LOG", log);
      }
    },
    extendDemo: function(id, hours, adminName){
      const s = loadState();
      const f = s.farmers.find(x => x.id === id);
      if(f){
        f.plan = "demo";
        const base = (f.demoExpires && f.demoExpires > Date.now()) ? f.demoExpires : Date.now();
        f.demoExpires = base + hours * 3600 * 1000;
        const log = { id: "log-" + Date.now(), adminName, action: `+${hours}H DEMO`, target: f.chacra, time: new Date().toLocaleTimeString("es-PE") };
        s.auditLogs.unshift(log);
        saveState(s, { type: "FARMER_EXTEND_DEMO", data: { id, hours, adminName } });
        publish("AUDIT_LOG", log);
      }
    },
    resetSketches: function(id, adminName){
      const s = loadState();
      const f = s.farmers.find(x => x.id === id);
      if(f){
        f.sketchesLeft = 3;
        const log = { id: "log-" + Date.now(), adminName, action: "RESET 3 BOCETOS", target: f.chacra, time: new Date().toLocaleTimeString("es-PE") };
        s.auditLogs.unshift(log);
        saveState(s, { type: "FARMER_RESET_SKETCHES", data: { id, adminName } });
        publish("AUDIT_LOG", log);
      }
    },

    // Inicio de sesion de un PRODUCTOR.
    // Sin backend: se busca en el estado local (como siempre).
    // Con backend: la contrasena la verifica el servidor y el productor
    // solo recibe SU ficha, no la de los demas.
    loginFarmer: async function(userOrEmail, password){
      const entrada = (userOrEmail || "").trim().toLowerCase();

      if(BACKEND.enabled){
        const r = await loginEnBackend(userOrEmail, password);
        if(!r.sinServidor){
          if(!r.success){
            return { success:false, error: r.error, suspended: r.suspended };
          }
          const st = await refrescarDelBackend();
          const id = (r.usuario && r.usuario.linked_farmer_id) || null;
          const ficha = st && id
            ? (st.farmers || []).find(f => f.id === id)
            : null;
          if(!ficha){
            return { success:false, error: "No encontramos tu registro. Contacta al equipo." };
          }
          return { success:true, farmer: ficha };
        }
        // Servidor caido: se sigue con el modo local.
      }

      const s = loadState();
      const farmers = s.farmers || [];
      const cleanPhone = entrada.replace(/[^0-9]/g, "");
      const found = farmers.find(f => {
        const fEmail = (f.email || "").toLowerCase();
        const fUsername = (f.username || "").toLowerCase();
        const fName = (f.name || "").toLowerCase();
        const fChacra = (f.chacra || "").toLowerCase();
        const fPhoneClean = (f.phone || "").replace(/[^0-9]/g, "");
        if(fEmail && fEmail === entrada) return true;
        if(fUsername && fUsername === entrada) return true;
        if(fName && fName === entrada) return true;
        if(fChacra && fChacra === entrada) return true;
        if(cleanPhone.length >= 6 && fPhoneClean.includes(cleanPhone)) return true;
        return false;
      });
      if(!found){
        return { success:false, error: "No encontramos ninguna chacra registrada con ese dato." };
      }
      const storedPass = found.passwordHash || found.password;
      const okPass = await verifyPassword(password, storedPass);
      if(!okPass){
        return { success:false, error: "Contrasena incorrecta para " + found.chacra + "." };
      }
      return { success:true, farmer: found };
    },

    // Registro de un productor nuevo.
    // Con backend: la cuenta se crea en el servidor (para que la entrada
    // con esa contrasena funcione desde cualquier celular).
    registerFarmer: async function(datos){
      if(BACKEND.enabled){
        const r = await api("/api/register", { method:"POST", body: datos });
        if(!r.sinServidor){
          if(!r.ok){
            return { success:false, error: (r.datos && r.datos.error) || "No se pudo completar el registro." };
          }
          await refrescarDelBackend();
          return { success:true, id: r.datos.id };
        }
      }
      // Modo local: se guarda en el estado del navegador.
      const ficha = Object.assign({
        id: "farmer-" + Date.now().toString(36),
        registered: Date.now(),
        online: false,
        plan: "demo",
        demoExpires: Date.now() + 24 * 60 * 60 * 1000,
        sketchesLeft: 3,
        allowPublicReserve: true,
        parcelLots: [],
        crm: [],
        legalStatus: { ruc:false, digesa:false, indecopi:false }
      }, datos);

      // La contrasena NUNCA se guarda en texto plano: se guarda su hash.
      if(ficha.password){
        ficha.passwordHash = (await sha256hex(ficha.password)) || "";
        delete ficha.password;
      }

      saveState(loadState(), { type:"FARMER_REGISTERED", data: ficha });
      const s = loadState();
      s.currentFarmerId = ficha.id;
      saveState(s);
      return { success:true, id: ficha.id };
    },

    // Inicio de sesion del panel ROOT (Nivel Dios).
    // Con el backend encendido, la clave maestra se verifica en el
    // servidor (no en el navegador). Sin backend, se usa el hash local
    // como siempre.
    loginRoot: async function(user, password){
      const entrada = (user || "").trim().toLowerCase();

      if(BACKEND.enabled){
        const r = await loginEnBackend(user, password);
        if(!r.sinServidor){
          if(!r.success){
            return { success:false, error: r.error || "Credenciales maestras invalidas. Acceso denegado." };
          }
          const st = await refrescarDelBackend();
          const ficha = st
            ? (st.admins || []).find(a =>
                String(a.user || "").toLowerCase() === entrada ||
                String(a.email || "").toLowerCase() === entrada)
            : null;
          // Al panel ROOT solo entra el ROOT.
          if(!ficha || ficha.role !== "ROOT"){
            guardarToken("");
            return { success:false, error:"Credenciales maestras invalidas. Acceso denegado." };
          }
          return { success:true, admin: ficha };
        }
        // Servidor caido: se cae de vuelta al modo local.
      }

      const ROOT_HASH = "28ce562658ab04a34db5f00cef3a029290ae3212f242b40883721203df4ac4a0";
      const ok = await verifyPassword(password, ROOT_HASH);
      if((entrada === "diego" || entrada === "diego.root@agroconecta.pe") && ok){
        return { success:true };
      }
      return { success:false, error:"Credenciales maestras invalidas. Acceso denegado." };
    },

    // Operaciones con Administradores
    loginAdmin: async function(userOrEmail, password){      // Con el backend encendido, la contrasena se verifica en el
      // servidor (no en el navegador). Si el servidor esta caido o sin
      // senal, se cae de vuelta al modo local para no dejar a nadie
      // afuera por falta de internet.
      if(BACKEND.enabled){
        const r = await loginEnBackend(userOrEmail, password);
        if(!r.sinServidor){
          if(!r.success){
            return { success:false, error: r.error, suspended: r.suspended };
          }
          const st = await refrescarDelBackend();
          const u = (userOrEmail || "").trim().toLowerCase();
          const ficha = st
            ? (st.admins || []).find(x =>
                String(x.user || "").toLowerCase() === u ||
                String(x.email || "").toLowerCase() === u)
            : null;
          return { success:true, admin: ficha || r.usuario };
        }
      }
      const s = loadState();
      const u = (userOrEmail || "").trim().toLowerCase();
      const cand = s.admins.find(x => x.user.toLowerCase() === u || x.email.toLowerCase() === u);
      if(!cand){
        return { success: false, error: "Credenciales incorrectas. Verifica usuario y contraseña." };
      }
      if(!(await verifyPassword(password, cand.passHash || cand.pass))){
        return { success: false, error: "Credenciales incorrectas. Verifica usuario y contraseña." };
      }
      const a = cand;
      if(a.status === "suspended"){
        return { success: false, error: "Tu cuenta ha sido SUSPENDIDA por el Administrador Root. Acceso denegado.", suspended: true };
      }
      // Registro en bitácora
      const log = { id: "log-" + Date.now(), adminName: a.name, action: "INICIO DE SESIÓN", target: a.role, time: new Date().toLocaleTimeString("es-PE") };
      s.auditLogs.unshift(log);
      saveState(s, { type: "AUDIT_LOG", data: log });
      return { success: true, admin: a };
    },
    suspendAdmin: function(adminId, rootName){
      const s = loadState();
      const a = s.admins.find(x => x.id === adminId);
      if(a && a.role !== "ROOT"){
        a.status = "suspended";
        const log = { id: "log-" + Date.now(), adminName: rootName || "ROOT", action: "SUSPENSIÓN EN VIVO", target: a.name + " (" + a.email + ")", time: new Date().toLocaleTimeString("es-PE") };
        s.auditLogs.unshift(log);
        saveState(s, { type: "ADMIN_SUSPENDED", data: { id: adminId, name: a.name } });
        publish("AUDIT_LOG", log);
      }
    },
    activateAdmin: function(adminId, rootName){
      const s = loadState();
      const a = s.admins.find(x => x.id === adminId);
      if(a){
        a.status = "active";
        const log = { id: "log-" + Date.now(), adminName: rootName || "ROOT", action: "REACTIVACIÓN", target: a.name, time: new Date().toLocaleTimeString("es-PE") };
        s.auditLogs.unshift(log);
        saveState(s, { type: "ADMIN_ACTIVATED", data: { id: adminId } });
        publish("AUDIT_LOG", log);
      }
    },
    createAdmin: async function(adminData, rootName){
      const s = loadState();
      const newAdmin = {
        id: "admin-" + Date.now(),
        name: adminData.name,
        user: adminData.user || adminData.email.split("@")[0],
        email: adminData.email,
        passHash: (await sha256hex(adminData.pass || "")) || DEFAULT_NEW_ADMIN_HASH,
        role: "Super Admin",
        cargo: adminData.cargo || "Administrador de Equipo",
        status: "active",
        createdAt: new Date().toISOString()
      };
      s.admins.push(newAdmin);
      const log = { id: "log-" + Date.now(), adminName: rootName || "ROOT", action: "CREACIÓN ADMIN", target: newAdmin.name, time: new Date().toLocaleTimeString("es-PE") };
      s.auditLogs.unshift(log);
      saveState(s, { type: "ADMIN_CREATED", data: newAdmin });
      publish("AUDIT_LOG", log);
      return newAdmin;
    },
    deleteAdmin: function(adminId, rootName){
      const s = loadState();
      const a = s.admins.find(x => x.id === adminId);
      if(a && a.role !== "ROOT"){
        s.admins = s.admins.filter(x => x.id !== adminId);
        const log = { id: "log-" + Date.now(), adminName: rootName || "ROOT", action: "ELIMINACIÓN ADMIN", target: a.name, time: new Date().toLocaleTimeString("es-PE") };
        s.auditLogs.unshift(log);
        saveState(s, { type: "ADMIN_DELETED", data: { id: adminId } });
        publish("AUDIT_LOG", log);
      }
    },

    // Chat en tiempo real
    sendChatMessage: function(farmerId, sender, text, farmerName, adminName){
      const s = loadState();
      const msg = {
        id: "msg-" + Date.now(),
        farmerId: farmerId || "farmer-01",
        farmerName: farmerName || "Chacra",
        sender: sender || "farmer",
        adminName: adminName || (sender === "admin" ? "Soporte Técnico" : null),
        text: text,
        time: new Date().toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit" })
      };
      s.supportChats.push(msg);
      saveState(s, { type: "CHAT_MESSAGE", data: msg });
      return msg;
    },

    // Anuncio Global
    sendGlobalAnnouncement: function(message, rootName){
      const s = loadState();
      s.globalAnnouncement = message;
      const log = { id: "log-" + Date.now(), adminName: rootName || "ROOT", action: "ANUNCIO GLOBAL", target: message.substring(0, 30) + "...", time: new Date().toLocaleTimeString("es-PE") };
      s.auditLogs.unshift(log);
      saveState(s, { type: "GLOBAL_ANNOUNCEMENT", data: { message, rootName } });
      publish("AUDIT_LOG", log);
    },
    clearGlobalAnnouncement: function(){
      const s = loadState();
      s.globalAnnouncement = null;
      saveState(s, { type: "GLOBAL_ANNOUNCEMENT", data: { message: null } });
    },

    // Códigos de desbloqueo
    generateMasterCode: function(customCode, rootName){
      const s = loadState();
      const code = (customCode || "AGRO" + Math.floor(1000 + Math.random() * 9000)).toUpperCase();
      if(!s.masterCodes.includes(code)){
        s.masterCodes.push(code);
        const log = { id: "log-" + Date.now(), adminName: rootName || "ROOT", action: "CÓDIGO GENERADO", target: code, time: new Date().toLocaleTimeString("es-PE") };
        s.auditLogs.unshift(log);
        saveState(s);
        publish("AUDIT_LOG", log);
      }
      return code;
    },
    verifyUnlockCode: function(code){
      const s = loadState();
      const c = (code || "").trim().toUpperCase();
      if(s.masterCodes.includes(c)){
        // Desbloquear agricultor actual
        const f = s.farmers.find(x => x.id === s.currentFarmerId) || s.farmers[0];
        if(f){
          f.plan = "plan30";
          f.demoExpires = Date.now() + 30 * 24 * 3600 * 1000;
          saveState(s, { type: "FARMER_ACTIVATED", data: { id: f.id, code: c } });
        }
        return true;
      }
      return false;
    },

    // Backup & Restore
    exportDatabaseJSON: function(){
      return JSON.stringify(loadState(), null, 2);
    },
    importDatabaseJSON: function(jsonStr){
      try {
        const parsed = JSON.parse(jsonStr);
        if(parsed && parsed.farmers && parsed.admins){
          saveState(parsed, { type: "STATE_CHANGED", data: parsed });
          return true;
        }
      } catch(e){}
      return false;
    },
    resetDatabase: function(){
      saveState(JSON.parse(JSON.stringify(DEFAULT_STATE)), { type: "STATE_CHANGED", data: DEFAULT_STATE });
    }
  };

  global.AgroCloudBridge = API;

  // Migrar contrasenas antiguas (en texto plano) a hash, una sola vez.
  try { migrateSecrets(); } catch(e){}
})(typeof window !== "undefined" ? window : global);
