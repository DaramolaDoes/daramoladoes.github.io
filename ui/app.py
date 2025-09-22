import os, requests, streamlit as st
API_BASE = os.getenv("OMS_API_BASE", "https://oms-olu-rag.odaramola03.workers.dev")
st.set_page_config(page_title="OMS • RAG Assistant", layout="centered")
st.title("OMS • RAG Assistant")
with st.form("ask"):
    q = st.text_input("Ask a question", placeholder="e.g., What was Tripadvisor total company revenue in 2024?")
    submitted = st.form_submit_button("Ask")
    if submitted and q.strip():
        try:
            r = requests.post(f"{API_BASE}/search", json={"q": q}, timeout=30)
            r.raise_for_status()
            data = r.json()
            st.subheader("Answer"); st.write(data.get("answer","(no answer)"))
            src = data.get("sources", [])
            if src:
                st.subheader("Sources")
                for s in src:
                    title = s.get("title") or "source"
                    url = s.get("url") or "#"
                    score = s.get("score")
                    score_txt = f" · score: `{score:.3f}`" if isinstance(score,(int,float)) else ""
                    st.markdown(f"- [{title}]({url}){score_txt}")
        except Exception as e:
            st.error(f"Request failed: {e}")
