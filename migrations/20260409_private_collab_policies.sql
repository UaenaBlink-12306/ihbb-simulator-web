DROP POLICY IF EXISTS "Anyone can read classes" ON classes;
DROP POLICY IF EXISTS "Teachers and enrolled students can read classes" ON classes;
CREATE POLICY "Teachers and enrolled students can read classes" ON classes FOR SELECT USING (
  auth.uid() = teacher_id
  OR EXISTS (SELECT 1 FROM class_students cs WHERE cs.class_id = classes.id AND cs.student_id = auth.uid())
);

CREATE OR REPLACE FUNCTION join_class_by_code(p_code TEXT)
RETURNS TABLE(id UUID, name TEXT, code VARCHAR)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_class public.classes%ROWTYPE;
BEGIN
  SELECT *
    INTO target_class
    FROM public.classes
   WHERE UPPER(TRIM(code)) = UPPER(TRIM(p_code))
   LIMIT 1;

  IF target_class.id IS NULL THEN
    RAISE EXCEPTION 'Class not found' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.class_students (class_id, student_id)
  VALUES (target_class.id, auth.uid())
  ON CONFLICT (class_id, student_id) DO NOTHING;

  RETURN QUERY
  SELECT target_class.id, target_class.name, target_class.code;
END;
$$;

GRANT EXECUTE ON FUNCTION join_class_by_code(TEXT) TO authenticated;

DROP POLICY IF EXISTS "Anyone can read rooms" ON bee_rooms;
DROP POLICY IF EXISTS "Hosts and room members can read rooms" ON bee_rooms;
CREATE POLICY "Hosts and room members can read rooms" ON bee_rooms FOR SELECT USING (
  auth.uid() = host_id
  OR EXISTS (SELECT 1 FROM bee_participants bp WHERE bp.room_id = bee_rooms.id AND bp.user_id = auth.uid())
);

DROP POLICY IF EXISTS "Anyone can read participants" ON bee_participants;
DROP POLICY IF EXISTS "Hosts and room members can read participants" ON bee_participants;
CREATE POLICY "Hosts and room members can read participants" ON bee_participants FOR SELECT USING (
  auth.uid() = user_id
  OR EXISTS (SELECT 1 FROM bee_rooms br WHERE br.id = bee_participants.room_id AND br.host_id = auth.uid())
  OR EXISTS (SELECT 1 FROM bee_participants me WHERE me.room_id = bee_participants.room_id AND me.user_id = auth.uid())
);

CREATE OR REPLACE FUNCTION join_bee_room_by_code(p_code TEXT, p_display_name TEXT DEFAULT NULL)
RETURNS TABLE(id UUID, code VARCHAR, host_id UUID, status VARCHAR, participant_count INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_room public.bee_rooms%ROWTYPE;
  already_joined BOOLEAN;
  current_count INTEGER;
BEGIN
  SELECT *
    INTO target_room
    FROM public.bee_rooms
   WHERE UPPER(TRIM(code)) = UPPER(TRIM(p_code))
   LIMIT 1;

  IF target_room.id IS NULL THEN
    RAISE EXCEPTION 'Room not found' USING ERRCODE = 'P0002';
  END IF;

  IF target_room.status = 'finished' THEN
    RAISE EXCEPTION 'This room has already ended.' USING ERRCODE = 'P0001';
  END IF;

  SELECT EXISTS (
    SELECT 1
      FROM public.bee_participants bp
     WHERE bp.room_id = target_room.id
       AND bp.user_id = auth.uid()
  ) INTO already_joined;

  SELECT COUNT(*)
    INTO current_count
    FROM public.bee_participants bp
   WHERE bp.room_id = target_room.id;

  IF NOT already_joined AND current_count >= 8 THEN
    RAISE EXCEPTION 'Room is full (max 8 players).' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.bee_participants (room_id, user_id, display_name, score)
  VALUES (target_room.id, auth.uid(), NULLIF(TRIM(COALESCE(p_display_name, '')), ''), 0)
  ON CONFLICT (room_id, user_id)
  DO UPDATE SET display_name = COALESCE(EXCLUDED.display_name, public.bee_participants.display_name);

  SELECT COUNT(*)
    INTO current_count
    FROM public.bee_participants bp
   WHERE bp.room_id = target_room.id;

  RETURN QUERY
  SELECT target_room.id, target_room.code, target_room.host_id, target_room.status, current_count;
END;
$$;

GRANT EXECUTE ON FUNCTION join_bee_room_by_code(TEXT, TEXT) TO authenticated;
