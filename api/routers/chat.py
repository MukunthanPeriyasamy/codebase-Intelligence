import asyncio
from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import StreamingResponse
from fastapi.websockets import WebSocketState

from api.logger import get_logger
from api.schemas import ChatCompletionRequest
from api.services.research import RepoNotIndexedError
from api.services.document_chat import document_chat
from api.services.document_context import NoDocumentError, NO_DOCUMENT

logger = get_logger(__name__)


router = APIRouter(tags=["chat"])


async def _send_if_connect(websocket: WebSocket, msg: str):
    if websocket.application_state == WebSocketState.CONNECTED:
        await websocket.send_text(msg)


@router.post("/documents/retrieve")
async def inspect_document_retrieval(request: ChatCompletionRequest):
    """Inspect RAG evidence without generating an answer or reading source files."""
    from api.services.document_context import retrieve_documents
    from api.services.document_store import session_index
    if not request.messages or request.messages[-1].role != "user":
        raise HTTPException(status_code=400, detail="A user question is required")
    try:
        index = await asyncio.to_thread(session_index, request)
        scoped = request.model_copy(update={"document_session_id": index["session_id"]})
        evidence = await asyncio.to_thread(retrieve_documents, scoped, request.messages[-1].content)
        return {"index": index, "chunks": evidence.chunks, "source_cross_validation": False}
    except NoDocumentError:
        raise HTTPException(status_code=404, detail=NO_DOCUMENT)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc))


@router.websocket("/ws/chat")
async def handle_websocket_chat(websocket: WebSocket):
    """
    Handle WebSocket connection for chat completions.
    This replaces the HTTP streaming endpoint with a WebSocket connection.
    """
    await websocket.accept()
    try:
        request = ChatCompletionRequest(**await websocket.receive_json())
        if not request.messages or len(request.messages) == 0:
            await websocket.send_text("Error: No messages provided")
            return

        last_message = request.messages[-1]
        if last_message.role != "user":
            await websocket.send_text("Error: Last message must be from the user")
            return

        async for chunk in await document_chat(request):
            await websocket.send_text(chunk)

    except WebSocketDisconnect:
        logger.info("WebSocket disconnected")
    except NoDocumentError:
        await _send_if_connect(websocket, NO_DOCUMENT)
    except RepoNotIndexedError as e:
        await _send_if_connect(websocket, str(e))
    except ValueError as e:
        if "No valid documents with embeddings found" in str(e):
            txt_message = "Error: No valid document embeddings found. This may be due to embedding size inconsistencies or API errors during document processing. Please try again or check your repository content."
        else:
            txt_message = f"Error preparing retriever: {str(e)}"
        try:
            await _send_if_connect(websocket, txt_message)
        except Exception:
            pass
    except Exception as e:
        # Check for specific embedding-related errors
        if "All embeddings should be of the same size" in str(e):
            txt_message = "Error: Inconsistent embedding sizes detected. Some documents may have failed to embed properly. Please try again."
        else:
            txt_message = f"Error preparing retriever: {str(e)}"
        try:
            await _send_if_connect(websocket, txt_message)
        except Exception:
            pass
    finally:
        if websocket.application_state == WebSocketState.CONNECTED:
            await websocket.close()


@router.post("/chat/completions/stream")
async def chat_completions_stream(request: ChatCompletionRequest):
    """Stream a chat completion response directly using Google Generative AI"""  # Validate request
    if not request.messages or len(request.messages) == 0:
        raise HTTPException(status_code=400, detail="No messages provided")

    last_message = request.messages[-1]
    if last_message.role != "user":
        raise HTTPException(
            status_code=400, detail="Last message must be from the user"
        )

    try:
        async_respond = await document_chat(request=request)

    except NoDocumentError:
        return StreamingResponse(iter([NO_DOCUMENT]), media_type="text/event-stream")
    except RepoNotIndexedError as e:
        raise HTTPException(status_code=425, detail=str(e))
    except ValueError as e:
        if "No valid documents with embeddings found" in str(e):
            raise HTTPException(
                status_code=500,
                detail="No valid document embeddings found. This may be due to embedding size inconsistencies or API errors during document processing. Please try again or check your repository content.",
            )
        else:
            raise HTTPException(
                status_code=500, detail=f"Error preparing retriever: {str(e)}"
            )
    except Exception as e:
        if "All embeddings should be of the same size" in str(e):
            raise HTTPException(
                status_code=500,
                detail="Inconsistent embedding sizes detected. Some documents may have failed to embed properly. Please try again.",
            )
        else:
            raise HTTPException(
                status_code=500, detail=f"Error preparing retriever: {str(e)}"
            )

    try:
        return StreamingResponse(
            async_respond,
            media_type="text/event-stream",
        )

    except Exception as e_handler:
        error_msg = f"Error in streaming chat completion: {str(e_handler)}"
        logger.error(error_msg)
        raise HTTPException(status_code=500, detail=error_msg)
