bl_info = {
    "name": "Store-3D Blender Bridge",
    "author": "Store-3D",
    "version": (1, 1, 0),
    "blender": (3, 3, 0),
    "location": "View3D > Sidebar > Store-3D",
    "description": "Fetch queued Blender jobs from Store-3D API and import models",
    "category": "Import-Export",
}

import json
import os
import ssl
import tempfile
import urllib.error
import urllib.parse
import urllib.request

import bpy
from bpy.props import BoolProperty, IntProperty, StringProperty
from bpy.types import AddonPreferences, Operator, Panel


def _get_prefs(context):
    addon = context.preferences.addons.get(__name__)
    if not addon:
        return None
    return addon.preferences


def _json_from_text(text):
    try:
        return json.loads(text)
    except Exception:
        return {}


def _extract_error_message(payload, default):
    if isinstance(payload, dict):
        raw = payload.get("error") or payload.get("message")
        if isinstance(raw, str) and raw.strip():
            return raw.strip()
    return default


def _resolve_base_url(context):
    prefs = _get_prefs(context)
    if not prefs:
        raise RuntimeError("Bridge preferences are not available.")

    base_url = (prefs.server_url or "").strip().rstrip("/")
    if not base_url:
        raise RuntimeError("Set Server URL in addon settings.")
    if not (base_url.startswith("http://") or base_url.startswith("https://")):
        raise RuntimeError("Server URL must start with http:// or https://")
    return base_url


def _http_json(context, path, method="GET", body=None, use_auth=True):
    prefs = _get_prefs(context)
    base_url = _resolve_base_url(context)
    token = (prefs.api_token or "").strip()
    if use_auth and not token:
        raise RuntimeError("Set API token in addon settings.")

    url = f"{base_url}{path}"
    headers = {
        "Accept": "application/json",
    }
    if use_auth:
        headers["Authorization"] = f"Bearer {token}"

    data = None
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"

    request = urllib.request.Request(url=url, data=data, headers=headers, method=method)
    context_ssl = None
    if prefs.allow_insecure_tls:
        context_ssl = ssl._create_unverified_context()

    try:
        with urllib.request.urlopen(request, timeout=max(3, int(prefs.timeout_seconds)), context=context_ssl) as resp:
            text = resp.read().decode("utf-8", errors="replace")
            payload = _json_from_text(text)
            if isinstance(payload, dict):
                return payload
            raise RuntimeError("Server returned non-JSON response.")
    except urllib.error.HTTPError as err:
        text = err.read().decode("utf-8", errors="replace") if err.fp else ""
        payload = _json_from_text(text)
        msg = _extract_error_message(payload, text.strip() or f"HTTP {err.code}")
        raise RuntimeError(f"HTTP {err.code}: {msg}") from err
    except urllib.error.URLError as err:
        raise RuntimeError(f"Network error: {err.reason}") from err


def _download_file(context, url, suffix):
    prefs = _get_prefs(context)
    token = (prefs.api_token or "").strip() if prefs else ""

    headers = {}
    if token:
        headers["Authorization"] = f"Bearer {token}"

    request = urllib.request.Request(url=url, headers=headers, method="GET")
    context_ssl = None
    if prefs and prefs.allow_insecure_tls:
        context_ssl = ssl._create_unverified_context()

    with urllib.request.urlopen(request, timeout=max(3, int(prefs.timeout_seconds)), context=context_ssl) as resp:
        payload = resp.read()

    fd, temp_path = tempfile.mkstemp(prefix="store3d_bridge_", suffix=suffix)
    os.close(fd)
    with open(temp_path, "wb") as f:
        f.write(payload)
    return temp_path


def _infer_suffix(job):
    fmt = str(job.get("format", "")).strip().lower()
    if fmt in {"glb", "gltf", "obj", "stl"}:
        return f".{fmt}"
    download_url = str(job.get("downloadUrl", "")).strip()
    parsed = urllib.parse.urlparse(download_url)
    path = parsed.path or ""
    _, ext = os.path.splitext(path)
    ext = ext.lower()
    if ext in {".glb", ".gltf", ".obj", ".stl"}:
        return ext
    return ".glb"


def _ack_job(context, job_id, status, message=""):
    body = {"status": status}
    if message:
        body["message"] = message
    path = f"/api/dcc/blender/jobs/{urllib.parse.quote(job_id)}/ack"
    _http_json(context, path=path, method="POST", body=body)


def _pair_code(context, code):
    normalized_code = str(code or "").strip().upper()
    if not normalized_code:
        raise RuntimeError("Set Pair code in addon settings.")
    payload = _http_json(
        context,
        path="/api/dcc/blender/pair",
        method="PUT",
        body={"code": normalized_code},
        use_auth=False,
    )
    token = str(payload.get("token", "")).strip() if isinstance(payload, dict) else ""
    if not token:
        raise RuntimeError("Pairing response does not contain token.")
    return token


def _import_model_file(path):
    ext = os.path.splitext(path)[1].lower()
    before_names = {obj.name for obj in bpy.data.objects}

    if ext in {".glb", ".gltf"}:
        bpy.ops.import_scene.gltf(filepath=path)
    elif ext == ".obj":
        if hasattr(bpy.ops.wm, "obj_import"):
            bpy.ops.wm.obj_import(filepath=path)
        else:
            bpy.ops.import_scene.obj(filepath=path)
    elif ext == ".stl":
        if hasattr(bpy.ops.wm, "stl_import"):
            bpy.ops.wm.stl_import(filepath=path)
        else:
            bpy.ops.import_mesh.stl(filepath=path)
    else:
        raise RuntimeError(f"Unsupported file extension: {ext}")

    imported = [obj for obj in bpy.data.objects if obj.name not in before_names]
    return imported


def _move_to_collection(scene, objects, collection_name):
    if not collection_name or not objects:
        return

    collection = bpy.data.collections.get(collection_name)
    if not collection:
        collection = bpy.data.collections.new(collection_name)
        scene.collection.children.link(collection)

    for obj in objects:
        already_linked = any(coll.name == collection.name for coll in obj.users_collection)
        if not already_linked:
            collection.objects.link(obj)


class STORE3D_BRIDGE_Preferences(AddonPreferences):
    bl_idname = __name__

    server_url: StringProperty(
        name="Server URL",
        description="Base URL of your site",
        default="http://localhost:3000",
    )
    api_token: StringProperty(
        name="API Token",
        description="Must match BLENDER_BRIDGE_TOKEN on server",
        subtype="PASSWORD",
        default="",
    )
    pair_code: StringProperty(
        name="Pair code",
        description="One-time code from Store-3D website (e.g. A1B2-C3D4)",
        default="",
    )
    timeout_seconds: IntProperty(
        name="Timeout (sec)",
        default=30,
        min=3,
        max=300,
    )
    import_collection: StringProperty(
        name="Import Collection",
        description="Imported objects will also be linked to this collection",
        default="Store3D Imports",
    )
    allow_insecure_tls: BoolProperty(
        name="Allow insecure TLS",
        description="Disable certificate verification (for local/self-signed HTTPS only)",
        default=False,
    )

    def draw(self, _context):
        layout = self.layout
        layout.label(text="Store-3D Blender Bridge")
        layout.prop(self, "server_url")
        layout.prop(self, "api_token")
        layout.prop(self, "pair_code")
        layout.prop(self, "timeout_seconds")
        layout.prop(self, "import_collection")
        layout.prop(self, "allow_insecure_tls")


class STORE3D_BRIDGE_OT_TestConnection(Operator):
    bl_idname = "store3d_bridge.test_connection"
    bl_label = "Test connection"
    bl_description = "Validate token and API access"

    def execute(self, context):
        try:
            data = _http_json(context, "/api/dcc/blender/jobs?status=queued", method="GET")
            jobs = data.get("jobs", []) if isinstance(data, dict) else []
            self.report({"INFO"}, f"Connection OK. Queued jobs: {len(jobs)}")
            return {"FINISHED"}
        except Exception as exc:
            self.report({"ERROR"}, str(exc))
            return {"CANCELLED"}


class STORE3D_BRIDGE_OT_FetchJobs(Operator):
    bl_idname = "store3d_bridge.fetch_jobs"
    bl_label = "Fetch jobs"
    bl_description = "Fetch queued jobs from server"

    def execute(self, context):
        wm = context.window_manager
        try:
            data = _http_json(context, "/api/dcc/blender/jobs?status=queued", method="GET")
            jobs = data.get("jobs", []) if isinstance(data, dict) else []
            if not isinstance(jobs, list):
                jobs = []
            wm.store3d_bridge_jobs = json.dumps(jobs, ensure_ascii=True)
            wm.store3d_bridge_last_count = len(jobs)
            self.report({"INFO"}, f"Fetched {len(jobs)} queued jobs.")
            return {"FINISHED"}
        except Exception as exc:
            self.report({"ERROR"}, str(exc))
            return {"CANCELLED"}


class STORE3D_BRIDGE_OT_PairCode(Operator):
    bl_idname = "store3d_bridge.pair_code"
    bl_label = "Pair by code"
    bl_description = "Exchange one-time pair code for API token"

    def execute(self, context):
        prefs = _get_prefs(context)
        if not prefs:
            self.report({"ERROR"}, "Addon preferences are not available.")
            return {"CANCELLED"}
        try:
            token = _pair_code(context, prefs.pair_code)
            prefs.api_token = token
            prefs.pair_code = ""
            self.report({"INFO"}, "Pairing successful. API token saved.")
            return {"FINISHED"}
        except Exception as exc:
            self.report({"ERROR"}, str(exc))
            return {"CANCELLED"}


class STORE3D_BRIDGE_OT_ImportLatest(Operator):
    bl_idname = "store3d_bridge.import_latest"
    bl_label = "Import latest"
    bl_description = "Fetch and import latest queued job"

    def execute(self, context):
        prefs = _get_prefs(context)
        if not prefs:
            self.report({"ERROR"}, "Addon preferences are not available.")
            return {"CANCELLED"}

        temp_path = ""
        try:
            data = _http_json(context, "/api/dcc/blender/jobs?status=queued", method="GET")
            jobs = data.get("jobs", []) if isinstance(data, dict) else []
            if not isinstance(jobs, list) or not jobs:
                self.report({"INFO"}, "No queued jobs.")
                return {"CANCELLED"}

            job = jobs[0]
            job_id = str(job.get("jobId", "")).strip()
            download_url = str(job.get("downloadUrl", "")).strip()
            if not job_id or not download_url:
                raise RuntimeError("Invalid job payload: jobId/downloadUrl is missing.")

            _ack_job(context, job_id, "picked", "Picked by Blender addon.")

            suffix = _infer_suffix(job)
            temp_path = _download_file(context, download_url, suffix=suffix)
            imported_objects = _import_model_file(temp_path)

            collection_name = (prefs.import_collection or "").strip()
            _move_to_collection(context.scene, imported_objects, collection_name)

            _ack_job(context, job_id, "imported", "Imported to Blender.")
            self.report(
                {"INFO"},
                f"Imported job {job_id[:10]}... Objects: {len(imported_objects)}",
            )
            return {"FINISHED"}
        except Exception as exc:
            message = str(exc)
            try:
                data = _http_json(context, "/api/dcc/blender/jobs?status=queued", method="GET")
                jobs = data.get("jobs", []) if isinstance(data, dict) else []
                if isinstance(jobs, list) and jobs:
                    job_id = str(jobs[0].get("jobId", "")).strip()
                    if job_id:
                        try:
                            _ack_job(context, job_id, "error", message[:220])
                        except Exception:
                            pass
            except Exception:
                pass
            self.report({"ERROR"}, message)
            return {"CANCELLED"}
        finally:
            if temp_path and os.path.isfile(temp_path):
                try:
                    os.remove(temp_path)
                except Exception:
                    pass


class STORE3D_BRIDGE_PT_Panel(Panel):
    bl_label = "Store-3D Blender Bridge"
    bl_idname = "STORE3D_BRIDGE_PT_panel"
    bl_space_type = "VIEW_3D"
    bl_region_type = "UI"
    bl_category = "Store-3D"

    def draw(self, context):
        layout = self.layout
        prefs = _get_prefs(context)
        wm = context.window_manager

        if not prefs:
            layout.label(text="Addon preferences unavailable.", icon="ERROR")
            return

        layout.prop(prefs, "server_url")
        layout.prop(prefs, "api_token")
        layout.prop(prefs, "pair_code")
        layout.operator("store3d_bridge.pair_code", icon="KEY_HLT")

        row = layout.row(align=True)
        row.operator("store3d_bridge.test_connection", icon="CHECKMARK")
        row.operator("store3d_bridge.fetch_jobs", icon="FILE_REFRESH")

        layout.operator("store3d_bridge.import_latest", icon="IMPORT")
        layout.separator()

        layout.label(text=f"Queued (cached): {int(wm.store3d_bridge_last_count)}")
        jobs = []
        try:
            jobs = json.loads(wm.store3d_bridge_jobs) if wm.store3d_bridge_jobs else []
        except Exception:
            jobs = []
        if isinstance(jobs, list) and jobs:
            first = jobs[0]
            job_id = str(first.get("jobId", "")).strip()
            asset_id = str(first.get("assetId", "")).strip()
            layout.label(text=f"Next job: {job_id[:16]}")
            layout.label(text=f"Asset: {asset_id[:16]}")
        else:
            layout.label(text="No cached jobs.")


CLASSES = (
    STORE3D_BRIDGE_Preferences,
    STORE3D_BRIDGE_OT_TestConnection,
    STORE3D_BRIDGE_OT_FetchJobs,
    STORE3D_BRIDGE_OT_PairCode,
    STORE3D_BRIDGE_OT_ImportLatest,
    STORE3D_BRIDGE_PT_Panel,
)


def register():
    for cls in CLASSES:
        bpy.utils.register_class(cls)
    bpy.types.WindowManager.store3d_bridge_jobs = StringProperty(
        name="Store3D Bridge Jobs JSON",
        default="[]",
        options={"HIDDEN"},
    )
    bpy.types.WindowManager.store3d_bridge_last_count = IntProperty(
        name="Store3D Bridge Last Count",
        default=0,
        min=0,
        options={"HIDDEN"},
    )


def unregister():
    if hasattr(bpy.types.WindowManager, "store3d_bridge_last_count"):
        del bpy.types.WindowManager.store3d_bridge_last_count
    if hasattr(bpy.types.WindowManager, "store3d_bridge_jobs"):
        del bpy.types.WindowManager.store3d_bridge_jobs
    for cls in reversed(CLASSES):
        bpy.utils.unregister_class(cls)


if __name__ == "__main__":
    register()
