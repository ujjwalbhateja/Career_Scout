"""Production composition entrypoint. Infrastructure supplies authenticated context/adapters."""

import argparse
import asyncio
import json

from career_scout.agents.master.agent import build_graph
from career_scout.catalog import TOOL_SPECS, create_registry
from career_scout.contracts import RunContext, WorkflowRequest
from career_scout.policy import route
from career_scout.tools import ToolRegistry


async def run(
    request: WorkflowRequest,
    *,
    context: RunContext,
    registry: ToolRegistry | None = None,
    max_revisions: int = 2,
) -> dict:
    """Do not expose context/registry/state setters in an unauthenticated HTTP endpoint."""
    # Revalidate even model instances created with unchecked model_construct/model_copy.
    request = WorkflowRequest.model_validate(request.model_dump())
    context = RunContext.model_validate(context.model_dump())
    session = (registry or create_registry()).session(context)
    graph = build_graph(session, max_revisions=max_revisions)
    result = await graph.ainvoke(
        {"request": request, "revisions": 0, "audit": [route("user", "master")]},
        config={"recursion_limit": 50},
    )
    # The result can contain private data; it belongs only to the authenticated caller.
    return {**result, "tool_calls": session.calls}


def main():
    parser = argparse.ArgumentParser(description="Career Scout Python agent foundation")
    parser.add_argument("command", choices=["contracts", "check"])
    args = parser.parse_args()
    if args.command == "contracts":
        print(
            json.dumps(
                [
                    {
                        "name": spec.name,
                        "owner": spec.owner,
                        "description": spec.description,
                        "side_effect": spec.side_effect,
                        "input": spec.input_model.model_json_schema(),
                        "output": spec.output_model.model_json_schema(),
                    }
                    for spec in TOOL_SPECS
                ],
                indent=2,
            )
        )
    else:
        result = asyncio.run(
            run(
                WorkflowRequest(),
                context=RunContext(owner_id="local-check", request_id="check"),
            )
        )
        print(json.dumps({"status": result["status"], "tool_calls": result["tool_calls"]}))


if __name__ == "__main__":
    main()
