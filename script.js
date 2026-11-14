// ==========================================
// 1. НАЛАШТУВАННЯ 3D СЦЕНИ
// ==========================================
const canvas = document.getElementById('space-canvas');
const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.z = 12;

const renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

scene.add(new THREE.AmbientLight(0xffffff, 0.5));
const sunLight = new THREE.DirectionalLight(0xffffff, 1.9);
sunLight.position.set(12, 6, 10);
scene.add(sunLight);

// Зорі
const starsGeometry = new THREE.BufferGeometry();
const posArray = new Float32Array(3500 * 3);
for (let i = 0; i < 10500; i++) posArray[i] = (Math.random() - 0.5) * 110;
starsGeometry.setAttribute('position', new THREE.BufferAttribute(posArray, 3));
const starField = new THREE.Points(
    starsGeometry,
    new THREE.PointsMaterial({ size: 0.07, color: 0xffffff, transparent: true, opacity: 0.85 })
);
scene.add(starField);

// Завантажувач реальних текстур NASA
const textureLoader = new THREE.TextureLoader();
const maxAnisotropy = renderer.capabilities.getMaxAnisotropy();

function loadPlanetTexture(path) {
    const texture = textureLoader.load(path);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = maxAnisotropy;
    return texture;
}

const sunUniforms = {
    uTime: { value: 0 }
};

// Спільний 3D Simplex Noise для поверхні та полум'я
const simplexNoiseGLSL = `
    vec4 permute(vec4 x){return mod(((x*34.0)+1.0)*x, 289.0);}
    vec4 taylorInvSqrt(vec4 r){return 1.79284291400159 - 0.85373472095314 * r;}

    float snoise(vec3 v){ 
        const vec2  C = vec2(1.0/6.0, 1.0/3.0) ;
        const vec4  D = vec4(0.0, 0.5, 1.0, 2.0);
        vec3 i  = floor(v + dot(v, C.yyy) );
        vec3 x0 =   v - i + dot(i, C.xxx) ;
        vec3 g = step(x0.yzx, x0.xyz);
        vec3 l = 1.0 - g;
        vec3 i1 = min( g.xyz, l.zxy );
        vec3 i2 = max( g.xyz, l.zxy );
        vec3 x1 = x0 - i1 + 1.0 * C.xxx;
        vec3 x2 = x0 - i2 + 2.0 * C.xxx;
        vec3 x3 = x0 - 1. + 3.0 * C.xxx;
        i = mod(i, 289.0 ); 
        vec4 p = permute( permute( permute( 
                 i.z + vec4(0.0, i1.z, i2.z, 1.0 ))
               + i.y + vec4(0.0, i1.y, i2.y, 1.0 )) 
               + i.x + vec4(0.0, i1.x, i2.x, 1.0 ));
        float n_ = 1.0/7.0;
        vec3  ns = n_ * D.wyz - D.xzx;
        vec4 j = p - 49.0 * floor(p * ns.z *ns.z);
        vec4 x_ = floor(j * ns.z);
        vec4 y_ = floor(j - 7.0 * x_ );
        vec4 x = x_ *ns.x + ns.yyyy;
        vec4 y = y_ *ns.x + ns.yyyy;
        vec4 h = 1.0 - abs(x) - abs(y);
        vec4 b0 = vec4( x.xy, y.xy );
        vec4 b1 = vec4( x.zw, y.zw );
        vec4 s0 = floor(b0)*2.0 + 1.0;
        vec4 s1 = floor(b1)*2.0 + 1.0;
        vec4 sh = -step(h, vec4(0.0));
        vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy ;
        vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww ;
        vec3 p0 = vec3(a0.xy,h.x);
        vec3 p1 = vec3(a0.zw,h.y);
        vec3 p2 = vec3(a1.xy,h.z);
        vec3 p3 = vec3(a1.zw,h.w);
        vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2, p2), dot(p3,p3)));
        p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
        vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
        m = m * m;
        return 42.0 * dot( m*m, vec4( dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3) ) );
    }

    float fbm(vec3 p) {
        float value = 0.0;
        float amp = 0.5;
        for (int i = 0; i < 6; i++) {
            value += amp * snoise(p);
            p *= 2.1;
            amp *= 0.5;
        }
        return value;
    }
`;

// 1A. ЯДРО СОНЦЯ (ФОТОСФЕРА З ГРАНУЛЯЦІЄЮ ТА МАГНІТНИМИ ПЛЯМАМИ)
const sunSurfaceMaterial = new THREE.ShaderMaterial({
    uniforms: sunUniforms,
    vertexShader: `
        varying vec3 vNormal;
        varying vec3 vPos;
        void main() {
            vNormal = normalize(normalMatrix * normal);
            vPos = position;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: `
        uniform float uTime;
        varying vec3 vNormal;
        varying vec3 vPos;
        ${simplexNoiseGLSL}

        void main() {
            vec3 dir = normalize(vPos);
            
            // Викривлення потоків плазми (Domain Warping)
            vec3 q = vec3(
                fbm(dir * 2.5 + vec3(0.0, uTime * 0.08, 0.0)),
                fbm(dir * 2.5 + vec3(5.2, 1.3, uTime * 0.08)),
                fbm(dir * 2.5 + vec3(2.1, uTime * 0.08, 4.7))
            );

            // Дрібна вогняна грануляція
            float detail = fbm(dir * 14.0 + q * 2.5 - uTime * 0.12);
            // Великі сонячні плями
            float spots = snoise(dir * 3.2 + q * 1.2 + uTime * 0.04);

            float heat = clamp(0.55 + detail * 0.65 + spots * 0.35, 0.0, 1.0);

            // Реалістичний градієнт чорного тіла (від темних плям до білого жару)
            vec3 colDark = vec3(0.08, 0.005, 0.0);
            vec3 colRed = vec3(0.72, 0.09, 0.0);
            vec3 colOrange = vec3(1.0, 0.42, 0.02);
            vec3 colGold = vec3(1.0, 0.85, 0.25);
            vec3 colWhite = vec3(1.0, 0.99, 0.92);

            vec3 color = mix(colDark, colRed, smoothstep(0.05, 0.32, heat));
            color = mix(color, colOrange, smoothstep(0.32, 0.58, heat));
            color = mix(color, colGold, smoothstep(0.58, 0.82, heat));
            color = mix(color, colWhite, smoothstep(0.82, 0.98, heat));

            // Об'ємне затемнення країв (Limb darkening) + вогняний контур
            float ndotv = clamp(dot(vNormal, vec3(0.0, 0.0, 1.0)), 0.0, 1.0);
            color *= pow(ndotv, 0.42) * 1.15;
            float rim = pow(1.0 - ndotv, 3.8);
            color += vec3(1.0, 0.35, 0.04) * rim * 1.4;

            gl_FragColor = vec4(color, 1.0);
        }
    `
});

const sun = new THREE.Mesh(
    new THREE.SphereGeometry(4.2, 128, 128),
    sunSurfaceMaterial
);

// 1B. ЗОВНІШНЯ КОРОНА ТА ПРОТУБЕРАНЦІ (ЯЗИКИ ПОЛУМ'Я НАВКОЛО КРАЮ)
const sunCoronaMaterial = new THREE.ShaderMaterial({
    uniforms: sunUniforms,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.BackSide,
    vertexShader: `
        varying vec3 vNormal;
        varying vec3 vPos;
        void main() {
            vNormal = normalize(normalMatrix * normal);
            vPos = position;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: `
        uniform float uTime;
        varying vec3 vNormal;
        varying vec3 vPos;
        ${simplexNoiseGLSL}

        void main() {
            // Вираховуємо відстань від краю сфери
            float viewDot = dot(vNormal, vec3(0.0, 0.0, -1.0));
            float glow = pow(clamp(viewDot, 0.0, 1.0), 2.8);

            // Язики полум'я, що вириваються назовні
            vec3 dir = normalize(vPos);
            float flares = fbm(dir * 6.5 - uTime * 0.25);
            float flareMask = smoothstep(-0.1, 0.65, flares);

            float alpha = glow * (0.55 + flareMask * 0.85);
            vec3 coronaColor = mix(vec3(0.95, 0.22, 0.02), vec3(1.0, 0.72, 0.2), glow);

            gl_FragColor = vec4(coronaColor, alpha * 0.95);
        }
    `
});

const sunCoronaMesh = new THREE.Mesh(
    new THREE.SphereGeometry(4.85, 128, 128),
    sunCoronaMaterial
);
sun.add(sunCoronaMesh);
const sunOuterGlowMaterial = new THREE.ShaderMaterial({
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.BackSide,
    vertexShader: `
        varying vec3 vNormal;
        void main() {
            vNormal = normalize(normalMatrix * normal);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: `
        varying vec3 vNormal;
        void main() {
            // Рахуємо кут нахилу поверхні від центру до країв
            float intensity = pow(clamp(dot(vNormal, vec3(0.0, 0.0, -1.0)), 0.0, 1.0), 4.2);
            
            // Плавний перехід від гарячого помаранчевого до темного космосу
            vec3 glowColor = mix(vec3(0.95, 0.25, 0.02), vec3(1.0, 0.78, 0.3), intensity);
            
            gl_FragColor = vec4(glowColor, intensity * 0.85);
        }
    `
});

const sunOuterGlowMesh = new THREE.Mesh(
    new THREE.SphereGeometry(6, 64, 64),
    sunOuterGlowMaterial
);
sun.add(sunOuterGlowMesh);
sun.position.set(16, 4, 0);
scene.add(sun);
// ------------------------------------------
// 2. МАРС (РЕАЛЬНА ПОВЕРХНЯ NASA + РЕЛЬЄФ)
// ------------------------------------------
const marsTexture = loadPlanetTexture('textures/2k_mars.jpg');
const mars = new THREE.Mesh(
    new THREE.SphereGeometry(3.2, 64, 64),
    new THREE.MeshStandardMaterial({ 
        map: marsTexture,
        bumpMap: marsTexture,
        bumpScale: 0.04,
        roughness: 0.85,
        metalness: 0.05
    })
);
mars.rotation.z = THREE.MathUtils.degToRad(25.2);
mars.position.set(24, 12, -1.5);
mars.visible = false;
scene.add(mars);

// ------------------------------------------
// 3. МІСЯЦЬ (РЕАЛЬНА ПОВЕРХНЯ NASA + РЕЛЬЄФ)
// ------------------------------------------
const moonTexture = loadPlanetTexture('textures/2k_moon.jpg');
const moon = new THREE.Mesh(
    new THREE.SphereGeometry(3.2, 64, 64),
    new THREE.MeshStandardMaterial({ 
        map: moonTexture,
        bumpMap: moonTexture,
        bumpScale: 0.05,
        roughness: 0.92,
        metalness: 0.05
    })
);
moon.rotation.z = THREE.MathUtils.degToRad(6.7);
moon.position.set(24, 12, -1.5);
moon.visible = false;
scene.add(moon);

function animate() {
    requestAnimationFrame(animate);
    sunUniforms.uTime.value += 0.015;
    starField.rotation.y += 0.00015;
    sun.rotation.y += 0.0012;
    mars.rotation.y += 0.003;
    moon.rotation.y += 0.002;
    renderer.render(scene, camera);
}

animate();

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// ==========================================
// 2. GSAP SCROLLTRIGGER ХОРЕОГРАФІЯ (ПЛАВНИЙ ВЕРТИКАЛЬНИЙ СКРОЛ)
// ==========================================
gsap.registerPlugin(ScrollTrigger);

gsap.utils.toArray('.slide-left').forEach(el => {
    gsap.to(el, {
        opacity: 1, x: 0, duration: 1.2, ease: "power2.out",
        scrollTrigger: { trigger: el, start: "top 85%", end: "top 50%", scrub: 0.8 }
    });
});

gsap.to(sun.position, {
    x: -18, y: -2,
    scrollTrigger: { trigger: "#nasa-company", start: "top bottom", end: "bottom top", scrub: 1 }
});

function buildSmoothPlanetScene(sectionId, planetMesh, slidePrefix, totalSlides) {
    const leftEls = [];
    const rightEls = [];

    for (let i = 1; i <= totalSlides; i++) {
        leftEls.push(`#${slidePrefix}-${i} .from-left`);
        rightEls.push(`#${slidePrefix}-${i} .from-right`);
    }

    gsap.set(leftEls.join(', '), { x: -300, opacity: 0 });
    gsap.set(rightEls.join(', '), { x: 300, opacity: 0 });

    const tl = gsap.timeline({
        scrollTrigger: {
            trigger: sectionId,
            start: "top top",
            end: `+=${totalSlides * 950}`,
            pin: true,
            scrub: 1.2,
            onEnter: () => { planetMesh.visible = true; },
            onLeave: () => { planetMesh.visible = false; },
            onEnterBack: () => { planetMesh.visible = true; },
            onLeaveBack: () => { planetMesh.visible = false; }
        }
    });

    tl.set(planetMesh.position, { x: 24, y: 12 });

    tl.to(planetMesh.position, { x: 6, y: 3, duration: 2, ease: "power1.out" }, "step1")
      .to(`#${slidePrefix}-1 .from-left`, { x: 0, opacity: 1, duration: 2, ease: "power2.out" }, "step1")
      .to(`#${slidePrefix}-1 .from-right`, { x: 0, opacity: 1, duration: 2, ease: "power2.out" }, "step1")
      .to({}, { duration: 1.2 });

    for (let i = 2; i < totalSlides; i++) {
        const tag = `step${i}`;
        const prev = i - 1;

        if (i === 2) {
            tl.to(planetMesh.position, { x: 0, y: 0, duration: 2, ease: "power1.inOut" }, tag);
        }

        tl.to(`#${slidePrefix}-${prev} .from-left`, { x: -300, opacity: 0, duration: 1.4, ease: "power2.in" }, tag)
          .to(`#${slidePrefix}-${prev} .from-right`, { x: 300, opacity: 0, duration: 1.4, ease: "power2.in" }, tag)
          .to(`#${slidePrefix}-${i} .from-left`, { x: 0, opacity: 1, duration: 2, ease: "power2.out" }, `${tag}+=0.5`)
          .to(`#${slidePrefix}-${i} .from-right`, { x: 0, opacity: 1, duration: 2, ease: "power2.out" }, `${tag}+=0.5`)
          .to({}, { duration: 1.2 });
    }

    const lastTag = `step${totalSlides}`;
    const prevLast = totalSlides - 1;

    tl.to(`#${slidePrefix}-${prevLast} .from-left`, { x: -300, opacity: 0, duration: 1.4, ease: "power2.in" }, lastTag)
      .to(`#${slidePrefix}-${prevLast} .from-right`, { x: 300, opacity: 0, duration: 1.4, ease: "power2.in" }, lastTag)
      .to(planetMesh.position, { x: -6, y: -3, duration: 2, ease: "power1.inOut" }, lastTag)
      .to(`#${slidePrefix}-${totalSlides} .from-left`, { x: 0, opacity: 1, duration: 2, ease: "power2.out" }, `${lastTag}+=0.5`)
      .to(`#${slidePrefix}-${totalSlides} .from-right`, { x: 0, opacity: 1, duration: 2, ease: "power2.out" }, `${lastTag}+=0.5`)
      .to({}, { duration: 1.2 });

    tl.to(`#${slidePrefix}-${totalSlides} .from-left`, { x: -300, opacity: 0, duration: 1.4, ease: "power2.in" }, "exit")
      .to(`#${slidePrefix}-${totalSlides} .from-right`, { x: 300, opacity: 0, duration: 1.4, ease: "power2.in" }, "exit")
      .to(planetMesh.position, { x: -24, y: -12, duration: 2, ease: "power1.in" }, "exit");
}

buildSmoothPlanetScene("#mars", mars, "mars-slide", 7);
buildSmoothPlanetScene("#moon", moon, "moon-slide", 7);


// ==========================================
// 3. МОДАЛЬНІ ВІКНА
// ==========================================
const storiesData = {
    opportunity: {
        tag: "МАРС • 2004–2018",
        title: "Марсохід Opportunity (MER-B)",
        status: "Статус: Долина Наполегливості (Заснув під час бурі)",
        text: `
            <p><strong>Мета місії:</strong> Геологічна розвідка Марса у пошуках мінеральних слідів присутності рідкої води в минулому. Інженери закладали ресурс у 90 солів і пробіг 1 кілометр.</p>
            <p><strong>Інженерний рекорд:</strong> Opportunity пропрацював майже <strong>15 земних років</strong> і подолав <strong>45,16 км</strong>! Його сонячні панелі очищалися від пилу марсіанськими вихорами.</p>
            <p><strong>Головне відкриття:</strong> Ровер виявив сферичні конкреції гематиту («марсіанську чорницю»), які формуються виключно у воді, довівши, що давній Марс мав озера.</p>
            <p><strong>Фінал:</strong> У червні 2018 року планету накрила глобальна пилова буря. Останні дані ровера інженери переклали як: <em>«Моя батарея сідає, і стає темно»</em>.</p>
        `
    },
    ingenuity: {
        tag: "МАРС • 2021–2024",
        title: "Гелікоптер Ingenuity",
        status: "Статус: Дюни Єзеро (Пошкоджена лопать)",
        text: `
            <p><strong>Мета місії:</strong> Перевірити можливість керованого польоту в розрідженій атмосфері Марса (1% від земної).</p>
            <p><strong>Інженерний прорив:</strong> Карбонові лопаті оберталися зі швидкістю <strong>2500 об/хв</strong>. Замість 5 тестових польотів дрон виконав <strong>72 польоти</strong>.</p>
            <p><strong>Фінал:</strong> У січні 2024 року при посадці на піщану дюну пошкодилася кінцівка лопаті. Зараз апарат працює як нерухома метеостанція.</p>
        `
    },
    insight: {
        tag: "МАРС • 2018–2022",
        title: "Посадковий модуль InSight",
        status: "Статус: Рівнина Елізій (Покритий пилом)",
        text: `
            <p><strong>Мета місії:</strong> Перше глибоке сейсмічне дослідження внутрішньої будови Марса.</p>
            <p><strong>Наукове відкриття:</strong> Надчутливий сейсмометр SEIS зареєстрував понад <strong>1300 марсотрусів</strong>, що дозволило визначити розмір розплавленого ядра планети.</p>
            <p><strong>Фінал:</strong> У грудні 2022 року марсіанський пил повністю вкрив сонячні панелі, і апарат завершив роботу.</p>
        `
    },
    spirit: {
        tag: "МАРС • 2004–2010",
        title: "Марсохід Spirit (MER-A)",
        status: "Статус: Пагорби Колумбії, кратер Гусєва",
        text: `
            <p><strong>Мета місії:</strong> Пошук ознак давньої водної активності на протилежному боці планети від Opportunity.</p>
            <p><strong>Відкриття:</strong> Знайшов поклади чистого кремнезему та карбонатів — доказ того, що колись у кратері Гусєва вирували гідротермальні джерела.</p>
            <p><strong>Фінал:</strong> У 2009 році праве переднє колесо провалилося у пухкий сульфатний пісок. Ровер ще рік передавав дані як нерухома наукова станція до настання марсіанської зими.</p>
        `
    },
    viking1: {
        tag: "МАРС • 1976–1982",
        title: "Посадковий модуль Viking 1",
        status: "Статус: Рівнина Хриса (Станція пам'яті Томаса Матча)",
        text: `
            <p><strong>Історичний прорив:</strong> Перший космічний апарат, який успішно виконав повну програму досліджень на поверхні Марса і передав кольорові панорами.</p>
            <p><strong>Рекорд тривалості:</strong> Пропрацював 2245 марсіанських солів (понад 6 років), утримуючи рекорд довголіття до 2010 року.</p>
        `
    },
    sojourner: {
        tag: "МАРС • 1997",
        title: "Mars Pathfinder та ровер Sojourner",
        status: "Статус: Долина Арес",
        text: `
            <p><strong>Інженерія:</strong> Використав революційну систему посадки на надувних подушках. Шестиколісний робот Sojourner важив лише 10,6 кг.</p>
            <p><strong>Результати:</strong> Замість запланованого тижня пропрацював 83 дні, проаналізувавши хімічний склад марсіанських каменів альфа-протонним спектрометром.</p>
        `
    },
    phoenix: {
        tag: "МАРС • 2008",
        title: "Полярний посадковий зонд Phoenix",
        status: "Статус: Північний полярний регіон Марса",
        text: `
            <p><strong>Головний доказ:</strong> Роботизована рука-маніпулятор зняла верхній шар ґрунту на глибину 5 см і відкрила яскравий водяний лід, який за кілька днів сублімував на сонці.</p>
            <p><strong>Погода на полюсі:</strong> Лазерний лідар зафіксував сніг, що падав із хмар на висоті 4 км над поверхнею.</p>
        `
    },
    apollo11: {
        tag: "МІСЯЦЬ • 1969",
        title: "Посадковий модуль Apollo 11 («Орел»)",
        status: "Статус: Море Спокою",
        text: `
            <p><strong>Історичний артефакт:</strong> Нижній посадковий ступінь модуля досі стоїть на місці першої висадки людини з табличкою: <em>«Ми прийшли з миром від імені всього людства»</em>.</p>
            <p><strong>Науковий слід:</strong> Через відсутність атмосфери та вітру сліди астронавтів у місячному реголіті збережуться мільйони років.</p>
        `
    },
    lrrrs: {
        tag: "МІСЯЦЬ • 1969–ДОТЕПЕР",
        title: "Лазерні кутові відбивачі (LRRR)",
        status: "Статус: АКТИВНІ (Працюють до сьогодні!)",
        text: `
            <p><strong>Як це працює:</strong> Спеціальні панелі з кварцових призм повертають лазерний промінь точно назад до обсерваторії на Землі.</p>
            <p><strong>Науковий результат:</strong> Це єдине обладнання епохи Apollo, яке працює досі. Завдяки йому вчені виміряли, що Місяць віддаляється від Землі на <strong>3,8 см щороку</strong>.</p>
        `
    },
    lrv: {
        tag: "МІСЯЦЬ • 1971–1972",
        title: "Місячний електромобіль LRV",
        status: "Статус: Місця посадок Apollo 15, 16, 17",
        text: `
            <p><strong>Інженерія:</strong> Повнопривідний електромобіль вагою 210 кг, який складався у валізу всередині посадкового модуля і розвивав швидкість до 18 км/год.</p>
            <p><strong>Спадщина:</strong> Перед відльотом екіпажі залишали ровери на відстані 100 метрів, щоб їхні камери зняли зліт ракети з Місяця.</p>
        `
    },
    surveyor3: {
        tag: "МІСЯЦЬ • 1967 / 1969",
        title: "Зонд Surveyor 3 та візит Apollo 12",
        status: "Статус: Океан Бур",
        text: `
            <p><strong>Унікальна зустріч:</strong> У листопаді 1969 року екіпаж Apollo 12 здійснив точкову посадку за 160 метрів від безпілотного апарата Surveyor 3, що сів там у 1967 році.</p>
            <p><strong>Дослідження:</strong> Астронавти демонтували телекамеру та совок зонда і повернули їх на Землю, щоб вивчити, як 31 місяць у вакуумі та радіації вплинули на матеріали.</p>
        `
    },
    alsep: {
        tag: "МІСЯЦЬ • 1969–1977",
        title: "Наукові станції ALSEP",
        status: "Статус: П'ять посадкових майданчиків Apollo",
        text: `
            <p><strong>Автономна мережа:</strong> Кожна експедиція від Apollo 12 до Apollo 17 залишала комплекс приладів із ядерним джерелом живлення SNAP-27.</p>
            <p><strong>Відкриття:</strong> Сейсмометри зафіксували глибокі припливні місяцетруси та довели, що Місяць має тверде внутрішнє та рідке зовнішнє ядро.</p>
        `
    },
    grail: {
        tag: "МІСЯЦЬ • 2011–2012",
        title: "Зонди-близнюки GRAIL (Ebb і Flow)",
        status: "Статус: Кратер Саллі Райд (Північний полюс)",
        text: `
            <p><strong>Принцип роботи:</strong> Два апарати літали на низькій орбіті один за одним, вимірюючи найменші зміни відстані між собою через гравітаційні аномалії кори Місяця.</p>
            <p><strong>Фінал:</strong> 17 грудня 2012 року зонди завершили місію контрольованим зіткненням із гірським схилом поблизу кратера Гольдшмідт.</p>
        `
    },
    lcross: {
        tag: "МІСЯЦЬ • 2009",
        title: "Ударний зонд LCROSS",
        status: "Статус: Вічно затінений кратер Кабеус",
        text: `
            <p><strong>Експеримент:</strong> Розгінний ступінь Centaur масою понад 2 тонни врізався у дно кратера на швидкості 9000 км/год, а слідом пролетів науковий зонд LCROSS.</p>
            <p><strong>Знахідка:</strong> Аналіз викинутого шлейфу підтвердив значні запаси водяного льоду, аміаку та метану на південному полюсі Місяця.</p>
        `
    }
};

function openModal(id) {
    const data = storiesData[id];
    if (!data) return;
    document.getElementById('modal-tag').innerText = data.tag;
    document.getElementById('modal-title').innerText = data.title;
    document.getElementById('modal-status').innerText = data.status;
    document.getElementById('modal-body').innerHTML = data.text;
    document.getElementById('story-modal').style.display = 'flex';
}

function closeModal() {
    document.getElementById('story-modal').style.display = 'none';
}

window.onclick = function(event) {
    if (event.target === document.getElementById('story-modal')) closeModal();
};
// ==========================================
// РЕЖИМ «ЖИВОЇ ТРАНСЛЯЦІЇ» ВІД ПЕРШОЇ ОСОБИ (POV)
// ==========================================
(function initLiveTelemetryPOV() {
    const explorerEl = document.getElementById('explorer');
    const markersLayer = document.getElementById('markers-layer');
    const povOverlay = document.getElementById('pov-overlay');
    const povPanorama = document.getElementById('pov-panorama');

    if (!explorerEl || !markersLayer || !povOverlay) return;

    // База місій із реальними панорамами NASA у високій якості
    const missionsPOV = {
        mars: [
            { 
                name: 'Opportunity', lat: -2, lon: 354, 
                cam: 'PANCAM // SOL 5111 // LIVE FEED', 
                img: 'https://images-assets.nasa.gov/image/PIA17767/PIA17767~large.jpg', 
                'text': '«Пряма трансляція з кратера Індевор. Небо затягнуте глобальною пиловою бурею. Сонячні панелі фіксують критичне падіння напруги, сигнал повільно згасає...» '
            },
            { 
                name: 'Ingenuity', lat: 18, lon: 77, 
                cam: 'RTE COLOR CAM // FLIGHT 72 // ACTIVE', 
                img: 'https://images-assets.nasa.gov/image/PIA24647/PIA24647~large.jpg', 
                text: '«Вид з бортової навігаційної камери гелікоптера на дюни кратера Єзеро. Лопаті на піску, але цифрова телеметрія передає дані про атмосферний тиск.»' 
            },
            { 
                name: 'InSight', lat: 4.5, lon: 135, 
                cam: 'IDC CONTEXT CAM // SOL 1440', 
                img: 'https://images-assets.nasa.gov/image/PIA22849/PIA22849~large.jpg', 
                text: '«Телеметричний знімок з Рівнини Елізій. Сейсмометр фіксує тишу, сонячні панелі вкриті товстим шаром марсіанського пилу.»' 
            },
            { 
                name: 'Spirit', lat: -14.5, lon: 175, 
                cam: 'NAVCAM // TROY TRAP', 
                img: 'https://images-assets.nasa.gov/image/PIA04413/PIA04413~large.jpg', 
                text: '«Панорама з місця вимушеної стоянки біля пагорбів Колумбії. Похил корпусу становить 13 градусів, енергосистема працює у стаціонарному режимі.»' 
            },
            { 
                name: 'Viking 1', lat: 22.5, lon: 312, 
                cam: 'FACSIMILE CAM // ARCHIVE STREAM', 
                img: 'https://images-assets.nasa.gov/image/PIA00563/PIA00563~large.jpg', 
                text: '«Історичний архівний потік першої успішної місії на Рівнині Хриса. Бездоганна чорно-біла панорама марсіанського горизонту 1976 року.»' 
            },
            { 
                name: 'Sojourner', lat: 19.3, lon: 326, 
                cam: 'IMP ROVER CAM // 1997', 
                img: 'https://images-assets.nasa.gov/image/PIA01122/PIA01122~large.jpg', 
                text: '«Вид з платформи Pathfinder на мікро-ровер Sojourner біля валуна Йогі під час першої у світі експедиції колісного робота на Марсі.»' 
            },
            { 
                name: 'Phoenix', lat: 68.2, lon: 234, 
                cam: 'SSI ARCTIC CAM // SOL 150', 
                img: 'https://images-assets.nasa.gov/image/PIA10742/PIA10742~large.jpg', 
                text: '«Трансляція з полярного регіону. Роботизований ківш демонструє відкритий під поверхнею білий водяний лід під світлом полярного сонця.»' 
            }
        ],
        moon: [
            { 
                name: 'Apollo 11 «Орел»', lat: 0.7, lon: 23.5, 
                cam: 'HASSELBLAD ARCHIVE // SEA OF TRANQUILITY', 
                img: 'https://images-assets.nasa.gov/image/as11-40-5903/as11-40-5903~large.jpg', 
                text: '«Прямий ефір з Моря Спокою. Посадковий ступінь “Орел” нерухомо стоїть у місячному реголіті під чорним безповітряним небом.»' 
            },
            { 
                name: 'Лазерний відбивач', lat: 3.6, lon: 342.5, 
                cam: 'OPTICAL PRISM FEED // ACTIVE', 
                img: 'https://images-assets.nasa.gov/image/S71-42358/S71-42358~large.jpg', 
                text: '«Сигнал лазерного дальноміра із Землі зафіксовано. Кварцові призми відбивають світлові імпульси для вимірювання орбіти.»' 
            },
            { 
                name: 'Ровер LRV', lat: 26.1, lon: 3.6, 
                cam: 'GCTA TV CAM // APOLLO 15', 
                img: 'https://images-assets.nasa.gov/image/as15-88-11901/as15-88-11901~large.jpg', 
                text: '«Трансляція з місячного електромобіля біля підніжжя Апеннін. На задньому плані видніється темна борозна Гедлі.»' 
            },
            { 
                name: 'Surveyor 3', lat: -3.0, lon: 336.6, 
                cam: 'VIDICON CAM // 1969 VISIT', 
                img: 'https://images-assets.nasa.gov/image/as12-48-7136/as12-48-7136~large.jpg', 
                text: '«Архівний кадр обстеження апарата Surveyor 3 екіпажем Apollo 12 в Океані Бур перед демонтажем бортової камери.»' 
            },
            { 
                name: 'Станція ALSEP', lat: -3.5, lon: 337.0, 
                cam: 'SNAP-27 TELEMETRY STREAM', 
                img: 'https://images-assets.nasa.gov/image/as12-47-6913/as12-47-6913~large.jpg', 
                text: '«Науковий комплекс передає дані сейсмічних коливань кори Місяця через ядерне джерело живлення.»' 
            },
            { 
                name: 'Зонди GRAIL', lat: 75.6, lon: 333.4, 
                cam: 'MOONKAM ORBITAL STREAM', 
                img: 'https://images-assets.nasa.gov/image/PIA16587/PIA16587~large.jpg', 
                text: '«Гравітаційна карта високої чіткості, отримана зондами-близнюками під час низькоорбітального польоту над полюсом.»' 
            },
            { 
                name: 'Зонд LCROSS', lat: -84.7, lon: 311.3, 
                cam: 'NIR SPECTROMETER // IMPACT', 
                img: 'https://images-assets.nasa.gov/image/PIA12189/PIA12189~large.jpg', 
                text: '«Спектральний аналіз викинутої хмари у вічно затіненому кратері Кабеус. Підтверджено спектр водяної пари.»' 
            }
        ]
    };

    let currentPlanet = 'mars';
    let radarVisible = false;
    let dragging = false;
    let prevX = 0, prevY = 0;

    function getSpherePos(lat, lon, r) {
        const phi = (90 - lat) * (Math.PI / 180);
        const theta = (lon + 180) * (Math.PI / 180);
        return new THREE.Vector3(
            -(r * Math.sin(phi) * Math.cos(theta)),
            r * Math.cos(phi),
            r * Math.sin(phi) * Math.sin(theta)
        );
    }

    function buildMarkers(planetKey) {
        markersLayer.innerHTML = '';
        missionsPOV[planetKey].forEach(item => {
            const el = document.createElement('div');
            el.className = `pin-marker ${planetKey === 'mars' ? 'mars-pin' : ''}`;
            el.innerHTML = `<span class="pin-dot"></span><span class="pin-label">${item.name}</span>`;
            el.onclick = () => openPOV(item);
            markersLayer.appendChild(el);
        });
    }

    window.setExplorerPlanet = function(planetKey) {
        currentPlanet = planetKey;
        document.querySelectorAll('.planet-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.planet === planetKey);
        });
        if (radarVisible) {
            mars.visible = (planetKey === 'mars');
            moon.visible = (planetKey === 'moon');
            const mesh = planetKey === 'mars' ? mars : moon;
            gsap.to(mesh.position, { x: 2.2, y: -0.2, z: 0, duration: 0.7 });
        }
        buildMarkers(planetKey);
    };

    window.openPOV = function(item) {
        document.getElementById('pov-cam').innerText = item.cam;
        document.getElementById('pov-title').innerText = item.name;
        document.getElementById('pov-text').innerText = item.text;
        
        // Ефект підключення прямої трансляції (коротке мерехтіння)
        povPanorama.style.opacity = '0';
        povPanorama.style.backgroundImage = `url('${item.img}')`;
        povOverlay.style.display = 'block';
        
        gsap.to(povPanorama, { opacity: 1, duration: 0.5 });
    };

    window.closePOV = function() {
        povOverlay.style.display = 'none';
    };

    // Паралакс-ефект «огляду камерою» мишею в режимі трансляції
    povOverlay.addEventListener('mousemove', (e) => {
        const dx = ((e.clientX / window.innerWidth) - 0.5) * -30;
        const dy = ((e.clientY / window.innerHeight) - 0.5) * -20;
        povPanorama.style.transform = `translate(${dx}px, ${dy}px) scale(1.05)`;
    });

    explorerEl.addEventListener('mousedown', (e) => {
        if (e.target.closest('.pin-marker') || e.target.closest('.planet-btn')) return;
        dragging = true;
        prevX = e.clientX;
        prevY = e.clientY;
    });

    window.addEventListener('mousemove', (e) => {
        if (!dragging || !radarVisible) return;
        const mesh = currentPlanet === 'mars' ? mars : moon;
        mesh.rotation.y += (e.clientX - prevX) * 0.006;
        mesh.rotation.x = THREE.MathUtils.clamp(mesh.rotation.x + (e.clientY - prevY) * 0.004, -0.8, 0.8);
        prevX = e.clientX;
        prevY = e.clientY;
    });

    window.addEventListener('mouseup', () => { dragging = false; });

    ScrollTrigger.create({
        trigger: "#explorer",
        start: "top 60%",
        end: "bottom top",
        onEnter: () => { radarVisible = true; setExplorerPlanet(currentPlanet); },
        onLeave: () => { radarVisible = false; mars.visible = false; moon.visible = false; },
        onEnterBack: () => { radarVisible = true; setExplorerPlanet(currentPlanet); },
        onLeaveBack: () => { radarVisible = false; mars.visible = false; moon.visible = false; }
    });

    function syncMarkers() {
        requestAnimationFrame(syncMarkers);
        if (!radarVisible) {
            markersLayer.style.display = 'none';
            return;
        }
        markersLayer.style.display = 'block';

        const mesh = currentPlanet === 'mars' ? mars : moon;
        const list = missionsPOV[currentPlanet];
        const pins = markersLayer.querySelectorAll('.pin-marker');

        mesh.updateMatrixWorld();
        const center = new THREE.Vector3();
        mesh.getWorldPosition(center);

        list.forEach((item, i) => {
            const pin = pins[i];
            if (!pin) return;

            const worldPos = getSpherePos(item.lat, item.lon, 3.22).applyMatrix4(mesh.matrixWorld);
            const normal = worldPos.clone().sub(center).normalize();
            const toCam = camera.position.clone().sub(worldPos).normalize();
            const dot = normal.dot(toCam);

            if (dot > 0.1) {
                const screen = worldPos.clone().project(camera);
                pin.style.left = `${(screen.x * 0.5 + 0.5) * window.innerWidth}px`;
                pin.style.top = `${(-(screen.y * 0.5) + 0.5) * window.innerHeight}px`;
                pin.style.opacity = Math.min(1, dot * 2.5);
                pin.style.pointerEvents = 'auto';
            } else {
                pin.style.opacity = '0';
                pin.style.pointerEvents = 'none';
            }
        });
    }

    buildMarkers('mars');
    syncMarkers();
})();