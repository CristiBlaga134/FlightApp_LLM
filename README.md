# Skylin

## 1. Repository

- **Adresă:** https://github.com/CristiBlaga134/FlightApp_LLM
- **Vizibilitate:** public
- **Conținut:** întregul cod sursă al aplicației. Fișierele binare compilate nu sunt incluse - `node_modules/`, proiectele native generate (`mobile/android/`, `mobile/ios/`), bundle-urile (`mobile/dist/`), log-urile și cheile sunt excluse prin [`.gitignore`](.gitignore).

## 2. Pași de compilare

Aplicația este scrisă în JavaScript / TypeScript și nu necesită un pas separat de compilare pentru a fi rulată: backend-ul este Node.js (rulează direct), iar clientul mobil (TypeScript) este transpilat automat de bundler-ul Expo / Metro la lansare. Compilarea proiectului constă în clonarea codului sursă și instalarea dependințelor fiecărui modul:

```bash
# 1. Clonarea repository-ului
git clone https://github.com/CristiBlaga134/FlightApp_LLM.git
cd FlightApp_LLM

# 2. Instalarea dependințelor pentru backend
cd server
npm install
cd ..

# 3. Instalarea dependințelor pentru clientul mobil
cd mobile
npm install
cd ..
```

Opțional, generarea unui binar nativ (APK / IPA) pentru clientul mobil se face cu EAS Build:

```bash
cd mobile
npx eas build -p android
```

## 3. Pași de instalare și lansare

Cerințe preliminare: Node.js 18+, [Ollama](https://ollama.com), un browser bazat pe Chromium (Chrome / Edge / Brave) și Expo Go (sau un emulator Android / iOS).

**1. Pornirea motorului NLP local (Ollama):**

```bash
ollama pull qwen2.5:7b
ollama serve
```

**2. Pornirea backend-ului:**

```bash
cd server
cp .env.example .env
npm start
```

Serverul rulează pe `http://localhost:3000`.

**3. Pornirea clientului mobil:**

```bash
cd mobile
cp .env.example .env
npx expo start
```

Se deschide proiectul în Expo Go (scanând codul QR) sau într-un emulator Android / iOS. Telefonul și calculatorul trebuie să fie în aceeași rețea.
