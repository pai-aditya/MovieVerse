# MovieVerse
Welcome to MovieVerse, an innovative full-stack application that revolutionizes the way users interact with movies. Dive into an immersive movie browsing experience powered by The Movie DB's public APIs.

## Features

* **Movie Details:** Access comprehensive movie details including synopses, cast information, runtime, and directorial insights directly from the intuitive user interface.

* **Authentication:** Seamless Google OAuth integration via Passport.js ensures secure and hassle-free user login with their google account.

* **Review System:** Write and view detailed movie reviews, creating a vibrant community within the platform.

* **Watchlist:** Effortlessly track movies you intend to watch, maintaining a curated list for easy reference.

* **Custom Lists:** Create personalized lists to categorize and organize favorite movies based on preferences.

* **Data Management:** Users have complete control over their data, with the ability to modify, delete, or enhance their content within MovieVerse.

## [Demo Video](https://drive.google.com/drive/folders/1wb9zmC1krbIloWP-VyzXGDzafHVyW9g6)

## Tech Stack

* **Frontend:** React with Tailwind CSS
* **Backend:** Node.js with Express
* **Database:** PostgreSQL
* **Deployment:** Kubernetes — a real multi-node **kubeadm** cluster (lima VMs) with Prometheus/Grafana, Loki, ArgoCD, Kustomize. See [`kubeadm/README.md`](kubeadm/README.md) (cluster) and [`k8s/README.md`](k8s/README.md) (manifests)

## Getting Started

Clone the repository
`git clone https://github.com/pai-aditya/MovieVerse.git`

### Update .env file


This project utilizes an .env file to manage environment-specific configuration settings. Copy `.env.example` to `backend/.env` and set the following variables:

- `DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME:` PostgreSQL connection details (or set a single `DATABASE_URL`). The schema is created automatically on first boot (and by `npm run migrate`).

- `SESSION_SECRET:` Secret used to sign session cookies. Sessions are stored in PostgreSQL so the backend can run as multiple replicas.

- `CLIENT_ID and CLIENT_SECRET:` Optional Google OAuth credentials. Leave blank to use username/password auth only. To get a Google ClientID, go to the [credential Page](https://console.cloud.google.com/apis/credentials) (if you are new, [create a new project first](https://console.cloud.google.com/projectcreate)).


- `CLIENT_URL:` The URL where the frontend of MovieVerse is hosted. (e.g., http://localhost:5173)

- `SERVER_URL:` The URL where the backend server of MovieVerse is hosted. (e.g., http://localhost:5555)

**Server side**

Requires a running PostgreSQL instance matching your `backend/.env` (the schema is created automatically on startup).

```
cd backend
```

```
npm i
```

```
npm run dev
```

The server will start running on localhost:5555.

> Prefer Kubernetes? Skip the manual setup and run the whole stack (app + PostgreSQL + monitoring) on a local `kind` cluster — see [`k8s/README.md`](k8s/README.md).

***Client Side***


```
cd frontend
```

```
npm i
```

```
npm run dev
```

The client will start running on localhost:5173.

## Author

- Github: [pai-aditya](https://github.com/pai-aditya)
- Linkedin: [Aditya Pai](https://www.linkedin.com/in/aditya-pai-581b2621a/)
- Email: [pai.aditya2011@gmail.com](mailto:pai.aditya2011@gmail.com)