// ================================================================
// SEED-DATA.JS — Script para poblar Firestore con libros de prueba
// 
// INSTRUCCIONES DE USO:
// 1. Abre tu archivo index.html en el navegador.
// 2. Abre la consola del navegador (F12 → Console).
// 3. Copia y pega TODO el contenido de este archivo en la consola.
// 4. Presiona Enter para ejecutar.
// 5. Verás mensajes de confirmación por cada libro añadido.
// 6. ¡Listo! Ya puedes buscar estos libros en el portal.
//
// NOTA: Solo necesitas ejecutar esto UNA VEZ para cargar los datos
// de prueba en tu base de datos Firestore.
// ================================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, collection, addDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyDgDx7_6SEgR-s0J3ZcN6jnytQmS07oeEw",
    authDomain: "sistema-biblioteca-usm.firebaseapp.com",
    projectId: "sistema-biblioteca-usm",
    storageBucket: "sistema-biblioteca-usm.firebasestorage.app",
    messagingSenderId: "1017689286626",
    appId: "1:1017689286626:web:953b6d449475178f19fbbb",
    measurementId: "G-87T0JCTW7X"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// ----------------------------------------------------------------
// DATOS DE PRUEBA: 5 libros de muestra para la Biblioteca Central
// ----------------------------------------------------------------
const librosDePrueba = [
    {
        titulo: "Cálculo con Geometría Analítica",
        titulo_lower: "calculo con geometria analitica",
        autor: "Dennis G. Zill",
        autor_lower: "dennis g. zill",
        cota: "QA303 .Z55 2015",
        materia: "Matemáticas / Ingeniería",
        materia_lower: "matematicas / ingenieria",
        sede: "Biblioteca Central",
        anio: 2015,
        editorial: "McGraw-Hill",
        disponible: true,
        ejemplares: 4,
        palabrasClave: ["calculo", "geometria", "analitica", "zill", "matematicas", "derivadas", "integrales"]
    },
    {
        titulo: "Introducción al Derecho",
        titulo_lower: "introduccion al derecho",
        autor: "Agustín Squella Narducci",
        autor_lower: "agustin squella narducci",
        cota: "K230 .S68 2014",
        materia: "Derecho / Ciencias Jurídicas",
        materia_lower: "derecho / ciencias juridicas",
        sede: "Biblioteca Central",
        anio: 2014,
        editorial: "Editorial Jurídica de Chile",
        disponible: true,
        ejemplares: 2,
        palabrasClave: ["derecho", "introduccion", "squella", "juridico", "leyes", "normas"]
    },
    {
        titulo: "Farmacología Básica y Clínica",
        titulo_lower: "farmacologia basica y clinica",
        autor: "Bertram G. Katzung",
        autor_lower: "bertram g. katzung",
        cota: "RM300 .K38 2019",
        materia: "Farmacia / Ciencias de la Salud",
        materia_lower: "farmacia / ciencias de la salud",
        sede: "Biblioteca Central",
        anio: 2019,
        editorial: "McGraw-Hill / Lange",
        disponible: false,
        ejemplares: 0,
        palabrasClave: ["farmacologia", "katzung", "farmacia", "medicamentos", "clinica", "salud"]
    },
    {
        titulo: "Fundamentos de Programación con Java",
        titulo_lower: "fundamentos de programacion con java",
        autor: "Herbert Schildt",
        autor_lower: "herbert schildt",
        cota: "QA76.73 .J38 2021",
        materia: "Ingeniería de Sistemas / Informática",
        materia_lower: "ingenieria de sistemas / informatica",
        sede: "Biblioteca Central",
        anio: 2021,
        editorial: "Oracle Press",
        disponible: true,
        ejemplares: 3,
        palabrasClave: ["java", "programacion", "schildt", "informatica", "sistemas", "codigo", "software"]
    },
    {
        titulo: "Principios de Economía",
        titulo_lower: "principios de economia",
        autor: "N. Gregory Mankiw",
        autor_lower: "n. gregory mankiw",
        cota: "HB171 .M36 2020",
        materia: "Ciencias Económicas y Sociales",
        materia_lower: "ciencias economicas y sociales",
        sede: "Biblioteca Central",
        anio: 2020,
        editorial: "Cengage Learning",
        disponible: true,
        ejemplares: 5,
        palabrasClave: ["economia", "mankiw", "microeconomia", "macroeconomia", "mercados", "oferta", "demanda"]
    }
];

// ----------------------------------------------------------------
// FUNCIÓN DE CARGA: Inserta cada libro en la colección "libros"
// ----------------------------------------------------------------
async function cargarDatosDePrueba() {
    console.log("📚 Iniciando carga de datos de prueba...\n");

    const librosRef = collection(db, "libros");

    for (const libro of librosDePrueba) {
        try {
            const docRef = await addDoc(librosRef, libro);
            console.log(`✅ Libro añadido: "${libro.titulo}" (ID: ${docRef.id})`);
        } catch (error) {
            console.error(`❌ Error al añadir "${libro.titulo}":`, error);
        }
    }

    console.log("\n🎉 ¡Carga de datos de prueba completada!");
    console.log("Ahora puedes buscar estos libros en el portal.");
}

// Ejecutar la carga automáticamente
cargarDatosDePrueba();
