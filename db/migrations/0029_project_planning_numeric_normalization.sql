-- Normalize only bounded source-reference JSON numbers, preserving raw result bytes.
-- Exact binary64 rounding cells for integers 0..3; all endpoints round to
-- the integer (even significand). No float cast, epsilon or exponent expansion.
create function planning_source_reference(token text, source_count integer) returns integer
language plpgsql immutable strict as $$
declare parts text[]; digits text; exp_text text; exponent integer; decimal_order integer; value numeric; negative boolean;
begin
 if octet_length(token)>262144 or source_count not between 1 and 4 then raise exception using errcode='23514',message='Invalid source reference'; end if;
 parts:=regexp_match(token,'^(-?)(0|[1-9][0-9]*)(?:\.([0-9]+))?(?:[eE]([+-]?[0-9]+))?$');
 if parts is null then raise exception using errcode='23514',message='Invalid source reference'; end if;
 negative:=parts[1]='-';
 digits:=ltrim(parts[2]||coalesce(parts[3],''),'0');
 if digits='' then return 0; end if;
 exp_text:=coalesce(parts[4],'0');
 -- Only magnitude classification uses this cap; the mantissa has at most
 -- 262144 digits, so an exponent beyond six digits cannot cancel it.
 if length(ltrim(ltrim(exp_text,'+-'),'0'))>6 then
  if left(exp_text,1)='-' then return 0; end if;
  raise exception using errcode='23514',message='Invalid source reference';
 end if;
 exponent:=exp_text::integer;
 decimal_order:=length(digits)-length(coalesce(parts[3],''))+exponent-1;
 if decimal_order < -400 then return 0; end if;
 if decimal_order > 1 then raise exception using errcode='23514',message='Invalid source reference'; end if;
 -- Every rounding-cell endpoint has <=1075 fractional decimal places.
 -- Retain 2000 significant digits plus a sticky digit: this preserves the
 -- exact side of every endpoint, including equality, with bounded numeric size.
 if length(digits)>2000 then
  digits:=left(digits,2000)||case when substr(digits,2001) ~ '[1-9]' then '1' else '0' end;
 end if;
 value:=(digits||'e'||(decimal_order-length(digits)+1)::text)::numeric;
 if source_count>0 and value between 0 and 0.0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000024703282292062327208828439643411068618252990130716238221279284125033775363510437593264991818081799618989828234772285886546332835517796989819938739800539093906315035659515570226392290858392449105184435931802849936536152500319370457678249219365623669863658480757001585769269903706311928279558551332927834338409351978015531246597263579574622766465272827220056374006485499977096599470454020828166226237857393450736339007967761930577506740176324673600968951340535537458516661134223766678604162159680461914467291840300530057530849048765391711386591646239524912623653881879636239373280423891018672348497668235089863388587925628302755995657524455507255189313690836254779186948667994968324049705821028513185451396213837722826145437693412532098591327667236328125 then return 0; end if;
 if not negative and source_count>1 and value between 0.999999999999999944488848768742172978818416595458984375 and 1.00000000000000011102230246251565404236316680908203125 then return 1; end if;
 if not negative and source_count>2 and value between 1.99999999999999988897769753748434595763683319091796875 and 2.0000000000000002220446049250313080847263336181640625 then return 2; end if;
 if not negative and source_count>3 and value between 2.9999999999999997779553950749686919152736663818359375 and 3.0000000000000002220446049250313080847263336181640625 then return 3; end if;
 raise exception using errcode='23514',message='Invalid source reference';
end; $$;

create function normalize_generated_planning_output(output_text text, source_count integer) returns jsonb
language plpgsql immutable strict as $$
declare proposal json; task json; ref json; normalized jsonb; refs jsonb; tasks jsonb:='[]'::jsonb; indices integer[]; idx integer;
begin
 if octet_length(output_text)>262144 then raise exception using errcode='23514',message='Invalid generated output'; end if;
 -- json retains numeric lexemes (including huge exponents); cast to jsonb
 -- only after replacing reference numbers with their normalized integers.
 proposal:=output_text::json;
 for task in select * from json_array_elements(proposal->'tasks') loop
  indices:=array[]::integer[];
  for ref in select * from json_array_elements(task->'sourceReferences') loop
   if json_typeof(ref)<>'number' then raise exception using errcode='23514',message='Invalid source reference'; end if;
   idx:=planning_source_reference(ref::text,source_count);
   if idx=any(indices) then raise exception using errcode='23514',message='Duplicate source reference'; end if;
   indices:=array_append(indices,idx);
  end loop;
  if cardinality(indices)=0 then raise exception using errcode='23514',message='Invalid source reference'; end if;
  select jsonb_agg(i order by i) into refs from unnest(indices) i;
  select jsonb_object_agg(key,case when key='sourceReferences' then refs else value::jsonb end) into normalized from json_each(task);
  tasks:=tasks||jsonb_build_array(normalized);
 end loop;
 select jsonb_object_agg(key,case when key='tasks' then tasks else value::jsonb end) into normalized from json_each(proposal);
 return normalized;
end; $$;

create or replace function guard_project_planning_draft() returns trigger language plpgsql as $$
declare g project_planning_generations%rowtype; manifest jsonb; canonical_manifest text;
begin
 if TG_OP='DELETE' then raise exception using errcode='23514',message='Immutable planning draft'; end if;
 if TG_OP='UPDATE' then
  if (to_jsonb(new)-'status') is distinct from (to_jsonb(old)-'status') or old.status<>'draft' or new.status not in ('approved','rejected') then
   raise exception using errcode='23514',message='Immutable planning draft'; end if;
 elsif new.status<>'draft' then raise exception using errcode='23514',message='Planning must start pending'; end if;
 if new.origin='manual_import' then
  if not exists(select 1 from knowledge_documents d join knowledge_document_versions v on v.workspace_id=d.workspace_id and v.document_id=d.id
    where d.workspace_id=new.workspace_id and d.project_key=new.project_key and d.id=new.source_document_id and d.filename=new.source_filename and v.version=new.source_version and v.sha256=new.source_sha256)
   then raise exception using errcode='23514',message='Invalid planning source'; end if;
 elsif new.origin='ai_generated' then
  select * into g from project_planning_generations where workspace_id=new.workspace_id and project_key=new.project_key and id=new.generation_id;
  if not found or g.status<>'proposal_available' or g.requested_by<>new.created_by
   or g.request_fingerprint is distinct from new.generation_request_fingerprint or g.output_fingerprint is distinct from new.generation_output_fingerprint
   or g.plan_fingerprint is distinct from new.plan_fingerprint or g.manifest_json is distinct from new.generation_manifest
   or g.validation_version is distinct from new.validation_version then raise exception using errcode='23514',message='Invalid generated provenance'; end if;
  select jsonb_agg(jsonb_build_object('filename',filename,'version',version,'sha256',sha256) order by source_index) into manifest
   from project_planning_generation_sources where workspace_id=g.workspace_id and project_key=g.project_key and generation_id=g.id;
  select '['||string_agg('{"filename":'||to_json(filename)::text||',"version":'||version::text||',"sha256":'||to_json(sha256)::text||'}',',' order by source_index)||']' into canonical_manifest
   from project_planning_generation_sources where workspace_id=g.workspace_id and project_key=g.project_key and generation_id=g.id;
  if new.source_fingerprint is distinct from encode(sha256(convert_to(format('["pac.generated-draft.v1","%s","%s","%s",%s,"%s"]',g.request_fingerprint,g.output_fingerprint,g.plan_fingerprint,canonical_manifest,g.validation_version),'UTF8')),'hex')
   or new.revision<>new.save_expected_revision+1 then raise exception using errcode='23514',message='Invalid generated fingerprint'; end if;
  if manifest is distinct from new.generation_manifest or not exists(
   select 1 from workflow_runs r join workflow_model_invocations i on i.workspace_id=r.workspace_id and i.workflow_run_id=r.id
   join workflow_model_invocation_results o on o.workspace_id=i.workspace_id and o.workflow_run_id=r.id and o.model_invocation_id=i.id
   where r.workspace_id=g.workspace_id and r.project_id=g.project_key and r.runtime_id=g.run_id and i.invocation_id=g.run_id||'-invocation'
    and i.status='succeeded' and i.outcome='succeeded' and i.request_fingerprint=g.runtime_request_fingerprint
    and normalize_generated_planning_output(o.output_text,jsonb_array_length(new.generation_manifest)) = new.plan_json
    and o.output_fingerprint=g.output_fingerprint and 'sha256:'||encode(sha256(convert_to(o.output_text,'UTF8')),'hex')=g.output_fingerprint)
   then raise exception using errcode='23514',message='Generated result unavailable'; end if;
 else raise exception using errcode='23514',message='Invalid planning origin'; end if;
 return new;
end; $$;
